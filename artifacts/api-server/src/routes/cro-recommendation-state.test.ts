import { randomUUID } from "node:crypto";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/cro-service.js", () => ({
  analyzeCroPage: vi.fn().mockResolvedValue({ status: "available", findings: [] }),
}));
import router from "./cro.js";

describe.skipIf(!process.env.DATABASE_URL)("CRO recommendation state on isolated PostgreSQL", () => {
  const schema = `qa_cro_${randomUUID().replaceAll("-", "")}`;
  let client: Client;
  let connected = false;
  function appFor(orgId = "org-a", role = "owner") {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId, orgContext: { role }, orgDb: (sql: string, values: unknown[]) => client.query(sql, values) });
      next();
    });
    app.use(router);
    return app;
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || process.env.NODE_ENV !== "test") {
      throw new Error("Refusing CRO integration tests outside a loopback test database");
    }
    client = new Client({ connectionString: url.href });
    await client.connect();
    connected = true;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE behavior_events (
        org_id text, site_url text, page text, session_id text,
        event_type text, scroll_depth integer, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE behavior_site_tokens (org_id text, site_url text);
      INSERT INTO behavior_site_tokens VALUES ('org-a','https://a.example'),('org-b','https://b.example');
      CREATE TABLE cro_recommendations (
        id text PRIMARY KEY, org_id text NOT NULL, site_url text NOT NULL,
        page text NOT NULL, type text NOT NULL, title text NOT NULL,
        description text, source text, metadata jsonb, status text DEFAULT 'pending',
        ai_generated boolean, updated_at timestamptz DEFAULT now()
      );
    `);
  });
  beforeEach(async () => {
    await client.query("TRUNCATE behavior_events, cro_recommendations");
    await client.query(`INSERT INTO behavior_events (org_id,site_url,page,session_id,event_type)
      VALUES ('org-a','https://a.example','/contact','s-a','dead_click'),
             ('org-a','https://other.example','/contact','s-b','dead_click'),
             ('org-b','https://b.example','/private','s-c','rage_click')`);
  });
  afterAll(async () => {
    if (connected) {
      try { await client.query(`DROP SCHEMA ${schema} CASCADE`); }
      finally { await client.end(); }
    }
  });
  it("materializes separate recommendations for identical paths on different sites", async () => {
    const response = await request(appFor()).get("/cro");
    expect(response.status).toBe(200);
    expect(response.body.recommendations).toHaveLength(2);
    expect(new Set(response.body.recommendations.map((r: { id: string }) => r.id)).size).toBe(2);
    expect(response.body.recommendations.every((r: { page: string }) => r.page === "/contact")).toBe(true);
  });
  it("preserves the confirmed status across refreshes and changing observation order", async () => {
    const first = await request(appFor()).get("/cro");
    const id = first.body.recommendations.find((r: { siteUrl: string }) => r.siteUrl === "https://a.example").id;
    const update = await request(appFor()).patch(`/cro/recommendations/${id}`).send({ status: "implemented" });
    expect(update.status).toBe(200);
    expect(update.body.recommendation).toEqual({ id, status: "implemented" });
    await client.query(`INSERT INTO behavior_events (org_id,site_url,page,session_id,event_type)
      VALUES ('org-a','https://other.example','/contact','s-d','dead_click')`);
    const refreshed = await request(appFor()).get("/cro");
    expect(refreshed.body.recommendations.find((r: { id: string }) => r.id === id)?.status).toBe("implemented");
  });
  it("rejects foreign or nonexistent IDs, invalid states, and viewer writes", async () => {
    const first = await request(appFor()).get("/cro");
    const id = first.body.recommendations[0].id;
    expect((await request(appFor("org-b")).patch(`/cro/recommendations/${id}`).send({ status: "dismissed" })).status).toBe(404);
    expect((await request(appFor()).patch("/cro/recommendations/missing").send({ status: "dismissed" })).status).toBe(404);
    expect((await request(appFor()).patch(`/cro/recommendations/${id}`).send({ status: "invented" })).status).toBe(400);
    expect((await request(appFor("org-a", "viewer")).patch(`/cro/recommendations/${id}`).send({ status: "implemented" })).status).toBe(403);
  });
  it("generation returns the same persisted identifiers and cannot inspect another site's data", async () => {
    const first = await request(appFor()).get("/cro?siteUrl=https%3A%2F%2Fa.example");
    const generated = await request(appFor()).post("/cro/generate").send({ siteUrl: "https://a.example" });
    expect(generated.status).toBe(200);
    expect(generated.body.recommendations[0].id).toBe(first.body.recommendations[0].id);
    expect((await request(appFor("org-b")).post("/cro/generate").send({ siteUrl: "https://a.example" })).status).toBe(404);
  });
});
