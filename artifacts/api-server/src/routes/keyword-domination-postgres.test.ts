import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/keyword-engine.js", () => ({
  trackKeyword: vi.fn(), syncOrgRankings: vi.fn(), getRankingHistory: vi.fn(),
  getKeywordStats: vi.fn(), generateClusters: vi.fn(), generateOpportunities: vi.fn(),
  getAIRecommendations: vi.fn(), getKeywordLimit: vi.fn(),
}));

import { pool } from "@workspace/db";
import keywordsRouter from "./keywords.js";

const orgA = randomUUID();
const orgB = randomUUID();
const targetKeyword = "qa-fixture-keyword-domination";
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
    Object.assign(req, { orgId: orgA, userId: "qa-keyword-test",
      orgDb: (query: string, values?: unknown[]) => scopedQuery(orgA, query, values).then(result => ({ rows: result.rows })) });
    next();
  });
  server.use("/api", keywordsRouter);
  return server;
}
async function cleanup(orgId: string) { await scopedQuery(orgId, "DELETE FROM tracked_keywords WHERE org_id=$1", [orgId]); }
async function seed(orgId: string, keyword: string, position: number, change: number) {
  await scopedQuery(orgId,
    "INSERT INTO tracked_keywords (id,org_id,keyword,current_position,prev_position,position_change,search_volume,difficulty,url,intent,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)",
    [randomUUID(), orgId, keyword, position, position - change, change, 1200, 30, "https://qa-fixture.invalid/keyword", "commercial"]);
}

describe("Keyword Domination PostgreSQL integration (synthetic tracked-keyword rows)", () => {
  beforeAll(async () => {
    await seed(orgA, targetKeyword, 7, -3);
    await seed(orgB, "qa-fixture-foreign-keyword", 2, 1);
  });
  afterAll(async () => { await cleanup(orgA); await cleanup(orgB); });

  it("ranks only the requesting organization's persisted keywords", async () => {
    const response = await request(app()).get("/api/keywords/domination");
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ tracked: 1, top3: 0, strikingDistance: 1, atRisk: 1 });
    expect(response.body.opportunities).toHaveLength(1);
    expect(response.body.opportunities[0]).toMatchObject({ keyword: targetKeyword, position: 7, change: -3 });
    expect(response.body.atRisk[0].keyword).toBe(targetKeyword);
  });
});
