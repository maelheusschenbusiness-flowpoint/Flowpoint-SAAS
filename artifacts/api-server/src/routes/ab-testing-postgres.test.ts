import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { pool } from "@workspace/db";
import abTestingRouter from "./ab-testing.js";

const orgA = randomUUID();
const orgB = randomUUID();
const experimentA = randomUUID();
const experimentB = randomUUID();
const siteA = "https://qa-fixture.invalid";
const pageA = "/experiment-a";
async function scopedQuery(orgId: string, query: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const result = await client.query(query, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
function app() {
  const server = express();
  server.use((req, _res, next) => {
    Object.assign(req, { orgId: orgA, userId: "qa-ab-test",
      orgDb: (query: string, values?: unknown[]) => scopedQuery(orgA, query, values).then(result => ({ rows: result.rows })) });
    next();
  });
  server.use("/api", abTestingRouter);
  return server;
}
async function seedExperiment(orgId: string, id: string, site: string, page: string) {
  await scopedQuery(orgId,
    "INSERT INTO cro_experiments (id,org_id,site_url,page,name,variant_a,variant_b,status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'running')",
    [id, orgId, site, page, "synthetic QA experiment", JSON.stringify({label:"A"}), JSON.stringify({label:"B"})]);
}
async function seedEvent(orgId: string, experimentId: string, variant: string, eventType: string, sessionId: string) {
  await scopedQuery(orgId,
    "INSERT INTO behavior_events (id,org_id,session_id,site_url,page,event_type,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [randomUUID(), orgId, sessionId, siteA, pageA, eventType, JSON.stringify({experimentId, variant})]);
}
async function cleanup(orgId: string) {
  await scopedQuery(orgId, "DELETE FROM behavior_events WHERE org_id=$1", [orgId]);
  await scopedQuery(orgId, "DELETE FROM cro_experiments WHERE org_id=$1", [orgId]);
}

describe("A/B Testing PostgreSQL integration (synthetic experiment events)", () => {
  beforeAll(async () => {
    await seedExperiment(orgA, experimentA, siteA, pageA);
    await seedExperiment(orgB, experimentB, "https://foreign.qa-fixture.invalid", "/foreign");
    await seedEvent(orgA, experimentA, "A", "experiment_exposure", "a-exposure-1");
    await seedEvent(orgA, experimentA, "A", "experiment_exposure", "a-exposure-2");
    await seedEvent(orgA, experimentA, "A", "experiment_conversion", "a-exposure-1");
    await seedEvent(orgA, experimentA, "B", "experiment_exposure", "b-exposure-1");
    await seedEvent(orgB, experimentB, "B", "experiment_exposure", "foreign-exposure");
  });
  afterAll(async () => { await cleanup(orgA); await cleanup(orgB); });

  it("aggregates persisted events and returns only the requesting org's experiment", async () => {
    const response = await request(app()).get("/api/ab-testing/experiments");
    expect(response.status).toBe(200);
    expect(response.body.experiments).toHaveLength(1);
    expect(response.body.experiments[0].id).toBe(experimentA);
    expect(response.body.experiments[0].measurements).toEqual({
      A: { exposures: 2, conversions: 1 }, B: { exposures: 1, conversions: 0 },
    });
    expect(response.body.noData).toBe(false);
  });
});
