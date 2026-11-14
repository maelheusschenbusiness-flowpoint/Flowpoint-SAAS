/**
 * GET /keywords/:id/history et GET /keywords/opportunities : les parametres de
 * requete sont lus, pas devines.
 *
 * - l'historique est demande dans l'ordre de la signature du service
 *   (orgId, keywordId, days) : les deux premiers arguments etaient inverses, la
 *   requete filtrait `org_id = <id du mot-cle>` et rendait toujours une liste
 *   vide ;
 * - `?days=abc` ne devient plus NaN (interpole tel quel dans `INTERVAL`), et
 *   `?days=-5`, `0` ou `400` retombent sur la fenetre habituelle de 30 jours ;
 * - le `LIMIT` des opportunites est borne : `-5` ou `abc` ne partent plus dans
 *   la requete, `1000000` est plafonne.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ orgDb: vi.fn(), getRankingHistory: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
  pool: { query: vi.fn(), connect: vi.fn() },
  trackedKeywordsTable: {},
}));
vi.mock("../services/store.js", () => ({ store: { logActivity: vi.fn() } }));
vi.mock("../services/keyword-engine.js", () => ({
  trackKeyword: vi.fn(), syncOrgRankings: vi.fn(), getRankingHistory: m.getRankingHistory,
  getKeywordStats: vi.fn(), generateClusters: vi.fn(), generateOpportunities: vi.fn(),
  getAIRecommendations: vi.fn(), getKeywordLimit: vi.fn(),
}));
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_a: unknown, _b: unknown, n: () => void) => n(), resolvePlanFromDB: async () => "pro" }));
vi.mock("../middlewares/cacheControl.js", () => ({ withCache: () => (_a: unknown, _b: unknown, n: () => void) => n() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import router from "./keywords.js";

const app = (orgId = "org-a") => {
  const a = express();
  a.use((req, _res, next) => { Object.assign(req, { orgId, orgDb: m.orgDb, orgContext: { role: "owner" } }); next(); });
  a.use("/api", router);
  return a;
};

/** Dernier parametre transmis au dernier appel de orgDb : la valeur du LIMIT. */
function dernierParam(): unknown {
  const call = m.orgDb.mock.calls.at(-1);
  const params = (call?.[1] ?? []) as unknown[];
  return params.at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.orgDb.mockResolvedValue({ rows: [] });
  m.getRankingHistory.mockResolvedValue([]);
});

describe("GET /keywords/:id/history", () => {
  it("appelle le service dans l'ordre de sa signature : (orgId, keywordId, days)", async () => {
    const r = await request(app("org-a")).get("/api/keywords/kw-1/history");
    expect(r.status).toBe(200);
    expect(m.getRankingHistory).toHaveBeenCalledWith("org-a", "kw-1", 30);
  });

  it.each([
    ["7", 7],
    ["abc", 30],
    ["-5", 30],
    ["0", 30],
    ["400", 30],
    ["30abc", 30],
  ])("?days=%s donne %i jours", async (days, attendu) => {
    const r = await request(app("org-a")).get(`/api/keywords/kw-1/history?days=${days}`);
    expect(r.status).toBe(200);
    expect(m.getRankingHistory).toHaveBeenCalledWith("org-a", "kw-1", attendu);
  });

  it("restitue l'historique rendu par le service, avec son décompte", async () => {
    const rows = [
      { date: "2026-01-01", position: 12, volume: 400 },
      { date: "2026-01-02", position: 9, volume: 400 },
    ];
    m.getRankingHistory.mockResolvedValue(rows);
    const r = await request(app("org-a")).get("/api/keywords/kw-1/history?days=7");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ history: rows, count: 2 });
  });
});

describe("GET /keywords/opportunities", () => {
  it.each([
    [undefined, 20],
    ["-5", 1],
    ["abc", 20],
    ["1000000", 200],
    ["25", 25],
  ])("?limit=%s borne le LIMIT à %i", async (limit, attendu) => {
    const url = limit === undefined ? "/api/keywords/opportunities" : `/api/keywords/opportunities?limit=${limit}`;
    const r = await request(app("org-a")).get(url);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ opportunities: [], count: 0 });
    expect(dernierParam()).toBe(attendu);
  });
});
