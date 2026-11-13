/**
 * Constat 6 : POST /keywords (historique) inserait une colonne `language` absente du schema migre
 * (tracked_keywords) -> erreur PostgreSQL 42703 -> 500. Test sur le schema REEL cree par `pnpm run migrate`.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  resolvePlanFromDB: vi.fn(async () => "pro"),
}));
vi.mock("../services/keyword-engine.js", () => ({
  trackKeyword: vi.fn(), syncOrgRankings: vi.fn(), getRankingHistory: vi.fn(), getKeywordStats: vi.fn(),
  generateClusters: vi.fn(), generateOpportunities: vi.fn(), getAIRecommendations: vi.fn(),
  getKeywordLimit: vi.fn(() => 500),
}));
vi.mock("../middlewares/requireRole.js", () => ({ canWrite: (_q: unknown, _s: unknown, n: () => void) => n() }));

import { pool } from "@workspace/db";
import keywordsRouter from "./keywords.js";

const ORG = randomUUID();
async function scoped<T>(query: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org_id', $1, true)", [ORG]);
    const r = await c.query(query, values);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
}
const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    Object.assign(req, { orgId: ORG, userId: "kw-test", orgDb: (q: string, v?: unknown[]) => scoped(q, v).then(r => ({ rows: r.rows })) });
    next();
  });
  a.use("/api", keywordsRouter);
  return a;
};
afterAll(async () => { await scoped("DELETE FROM tracked_keywords WHERE org_id=$1", [ORG]); });

describe("POST /keywords (historique) sur le schema migre", () => {
  it("le schema migre n'a PAS de colonne language (cause du 500)", async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='tracked_keywords' AND column_name='language'`);
    expect(r.rowCount).toBe(0);
  });

  it("201 et la ligne est creee (avant : 500, colonne language inconnue)", async () => {
    const res = await request(app()).post("/api/keywords").send({ keyword: "plombier lyon", position: 5, volume: 900, difficulty: 30 });
    expect(res.status).toBe(201);
    expect(res.body.keyword).toBe("plombier lyon");
    expect(res.body.device).toBe("desktop");
    expect(res.body.location).toBe("France");
  });

  it("doublon : 409 (ON CONFLICT sur org/keyword/device/location), pas 500", async () => {
    const res = await request(app()).post("/api/keywords").send({ keyword: "plombier lyon" });
    expect(res.status).toBe(409);
  });
});
