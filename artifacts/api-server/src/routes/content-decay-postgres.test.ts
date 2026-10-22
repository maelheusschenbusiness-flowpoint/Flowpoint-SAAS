import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
const pageA = "https://qa-fixture.invalid/decay-a";
const pageB = "https://qa-fixture.invalid/decay-b";

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
  } finally {
    client.release();
  }
}
function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    Object.assign(req, {
      orgId: orgA, userId: "qa-content-decay-test",
      orgDb: (query: string, values?: unknown[]) => scopedQuery(orgA, query, values).then(result => ({ rows: result.rows })),
    });
    next();
  });
  server.use("/api", keywordsRouter);
  return server;
}
function dayAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
async function seed(orgId: string, page: string) {
  for (const row of [
    { date: dayAgo(40), clicks: 100, impressions: 1000, position: 4 },
    { date: dayAgo(5), clicks: 50, impressions: 900, position: 8 },
  ]) {
    await scopedQuery(orgId,
      "INSERT INTO gsc_page_data (id, org_id, page, date, clicks, impressions, position) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), orgId, page, row.date, row.clicks, row.impressions, row.position]);
  }
}
async function cleanup(orgId: string) {
  await scopedQuery(orgId, "DELETE FROM gsc_page_data WHERE org_id = $1", [orgId]);
}

describe("Content Decay Radar PostgreSQL integration (synthetic GSC fixtures)", () => {
  beforeAll(async () => {
    await seed(orgA, pageA);
    await seed(orgB, pageB);
  });
  afterAll(async () => {
    await cleanup(orgA);
    await cleanup(orgB);
  });

  it("reads real PostgreSQL rows for the requesting org and derives a measured decay", async () => {
    const response = await request(app()).get("/api/keywords/content-decay");
    expect(response.status).toBe(200);
    expect(response.body.source).toBe("google_search_console");
    expect(response.body.opportunities).toHaveLength(1);
    expect(response.body.opportunities[0]).toMatchObject({
      page: pageA,
      previous: { clicks: 100, impressions: 1000 },
      current: { clicks: 50, impressions: 900 },
      reasons: ["clicks_declining", "ranking_declining"],
    });
    expect(response.body.opportunities.some((item: { page: string }) => item.page === pageB)).toBe(false);
  });
});
