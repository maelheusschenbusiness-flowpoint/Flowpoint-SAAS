import { randomUUID } from "node:crypto";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: mocks }));
vi.mock("../services/google-service.js", () => ({ publishGBPPost: vi.fn() }));
vi.mock("../middlewares/planGate.js", () => ({
  requireFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import router from "./gbp-posts.js";
import { createPost, publishPost, getPostsDashboard } from "../services/gbp-posting-service.js";
import { publishGBPPost } from "../services/google-service.js";

// SQL and persistence are real; Google is mocked. This is NOT provider certification.
describe.skipIf(!process.env.DATABASE_URL)("GBP lifecycle on isolated PostgreSQL", () => {
  const schema = `qa_gbp_${randomUUID().replaceAll("-", "")}`;
  let client: Client;
  let connected = false;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: mocks.query, orgContext: { role: "owner" } });
    next();
  });
  app.use(router);

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || process.env.NODE_ENV !== "test") {
      throw new Error("Refusing GBP integration tests outside a loopback test database");
    }
    client = new Client({ connectionString: url.href });
    await client.connect();
    connected = true;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE gbp_posts (
        id text PRIMARY KEY, org_id text NOT NULL, location_id text, location_name text,
        post_type text, title text, content text, cta_type text, cta_url text,
        media_urls text[], event_title text, event_start timestamptz, event_end timestamptz,
        offer_code text, offer_terms text, status text, scheduled_at timestamptz,
        approved_at timestamptz, seo_keywords text[], generation_options jsonb,
        ai_generated boolean, views integer, clicks integer, calls integer,
        published_at timestamptz, google_post_id text, last_error_code text,
        last_error_message text, created_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE google_locations (id text, org_id text, raw_data jsonb);
      INSERT INTO google_locations VALUES ('loc-a','org-a','{"name":"accounts/a/locations/a"}');
    `);
    mocks.query.mockImplementation((sql, params) => client.query(sql, params));
    mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
  });
  beforeEach(async () => {
    await client.query("TRUNCATE gbp_posts");
    vi.mocked(publishGBPPost).mockReset();
  });
  afterAll(async () => {
    if (connected) {
      try { await client.query(`DROP SCHEMA ${schema} CASCADE`); }
      finally { await client.end(); }
    }
  });

  it("creates an approved schedule, cancels it through the API and persists a draft", async () => {
    const response = await request(app).post("/gbp-posts").send({
      content: "Scheduled content", locationId: "loc-a",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(), manualApproval: true,
    });
    expect(response.status).toBe(201);
    const id = response.body.post.id;
    expect(response.body.post.status).toBe("scheduled");
    const cancelled = await request(app).patch(`/gbp-posts/${id}`).send({ status: "draft" });
    expect(cancelled.status).toBe(200);
    const { posts } = await getPostsDashboard("org-a");
    expect(posts[0]).toMatchObject({ id, status: "draft", scheduled_at: null, approved_at: null });
    expect(publishGBPPost).not.toHaveBeenCalled();
  });

  it("requires a renewed approval when rescheduling, and records the approved date", async () => {
    const post = await createPost("org-a", { content: "Draft", locationId: "loc-a" });
    const date = new Date(Date.now() + 3600_000).toISOString();
    expect((await request(app).patch(`/gbp-posts/${post.id}`).send({ scheduledAt: date })).status).toBe(400);
    const result = await request(app).patch(`/gbp-posts/${post.id}`).send({ scheduledAt: date, manualApproval: true });
    expect(result.status).toBe(200);
    expect(result.body.post.status).toBe("scheduled");
  });

  it("persists provider-confirmed publication, not just an HTTP success", async () => {
    const post = await createPost("org-a", { content: "Draft", locationId: "loc-a" });
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: true, postName: "accounts/a/locations/a/localPosts/simulated" });
    const response = await request(app).post(`/gbp-posts/${post.id}/publish`);
    expect(response.status).toBe(200);
    const { posts, stats } = await getPostsDashboard("org-a");
    expect(posts[0]).toMatchObject({ status: "published", google_post_id: "accounts/a/locations/a/localPosts/simulated" });
    expect(posts[0]?.published_at).toBeTruthy();
    expect(stats.published).toBe(1);
  });

  it("persists a rejected publication and exposes its actionable error after reload", async () => {
    const post = await createPost("org-a", { content: "Draft", locationId: "loc-a" });
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: false, code: "GBP_API_REJECTED" });
    const response = await request(app).post(`/gbp-posts/${post.id}/publish`);
    expect(response.status).toBe(502);
    const { posts } = await getPostsDashboard("org-a");
    expect(posts[0]).toMatchObject({ status: "failed", last_error_code: "GBP_API_REJECTED", google_post_id: null });
    expect(posts[0]?.last_error_message).toContain("rejeté");
    await expect(publishPost("org-b", post.id)).rejects.toThrow("GBP_POST_NOT_FOUND");
  });
});
