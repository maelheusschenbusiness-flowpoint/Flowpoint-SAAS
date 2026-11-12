/**
 * GET /keywords : une organisation sans mot-cle recoit une liste vide, jamais des donnees
 * d'exemple, et jamais les mots-cles d'une autre organisation — meme hors production.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const m = vi.hoisted(() => ({ orgDb: vi.fn(), dbSelect: vi.fn(), dbInsert: vi.fn(), dbUpdate: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { select: m.dbSelect, insert: m.dbInsert, update: m.dbUpdate },
  pool: { query: vi.fn(), connect: vi.fn() },
  trackedKeywordsTable: {},
}));
vi.mock("../services/store.js", () => ({ store: { logActivity: vi.fn() } }));
vi.mock("../services/keyword-engine.js", () => ({
  trackKeyword: vi.fn(), syncOrgRankings: vi.fn(), getRankingHistory: vi.fn(), getKeywordStats: vi.fn(),
  generateClusters: vi.fn(), generateOpportunities: vi.fn(), getAIRecommendations: vi.fn(), getKeywordLimit: vi.fn(),
}));
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_a: unknown, _b: unknown, n: () => void) => n(), resolvePlanFromDB: async () => "pro" }));
vi.mock("../middlewares/cacheControl.js", () => ({ withCache: () => (_a: unknown, _b: unknown, n: () => void) => n() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import router from "./keywords.js";

const app = (orgId: string) => {
  const a = express();
  a.use((req, _res, next) => { Object.assign(req, { orgId, orgDb: m.orgDb, orgContext: { role: "owner" } }); next(); });
  a.use("/api", router);
  return a;
};

describe("GET /keywords sans donnée", () => {
  beforeEach(() => { vi.clearAllMocks(); m.orgDb.mockResolvedValue({ rows: [] }); });

  it.each(["development", "test", "staging", undefined])("NODE_ENV=%s : liste vide, aucune écriture, aucune lecture non scopée", async (env) => {
    const saved = process.env["NODE_ENV"];
    if (env === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = env;
    try {
      const r = await request(app("org-a")).get("/api/keywords");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ keywords: [], total: 0, hasData: false, source: "empty" });
      expect(m.dbInsert).not.toHaveBeenCalled();
      expect(m.dbUpdate).not.toHaveBeenCalled();
      expect(m.dbSelect).not.toHaveBeenCalled();
      expect(m.orgDb.mock.calls[0]![1]).toEqual(["org-a"]); // seule lecture : scopee a l'organisation
    } finally {
      if (saved === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = saved;
    }
  });

  it("le code ne contient plus de jeu de mots-clés d'exemple ni de lecture non filtrée", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/keywords.ts"), "utf8");
    expect(src).not.toMatch(/isDemoMode|const SEED|agence seo paris|source: "seeded"/);
  });
});
