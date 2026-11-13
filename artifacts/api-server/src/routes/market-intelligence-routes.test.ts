/**
 * Routes /market-intelligence : isolation par organisation, états « aucune donnée » vs « panne »
 * (503 explicite, jamais un corps vide présenté comme un succès), rôles et validation.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getMarketDashboard: vi.fn(), generateMarketReport: vi.fn(), detectCompetitorMovements: vi.fn(), orgDb: vi.fn(),
  role: { current: "owner" as string },
}));
vi.mock("../services/market-intel-service.js", () => ({
  getMarketDashboard: m.getMarketDashboard, generateMarketReport: m.generateMarketReport, detectCompetitorMovements: m.detectCompetitorMovements,
}));
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_a: unknown, _b: unknown, n: () => void) => n() }));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, res: express.Response, next: () => void) => (m.role.current === "viewer" ? res.status(403).json({ error: "Forbidden" }) : next()),
}));
import router from "./market-intelligence.js";

const app = (orgId = "org-a") => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { Object.assign(req, { orgId, orgDb: m.orgDb }); next(); });
  a.use("/api", router);
  return a;
};
const dash = (n: number) => ({
  trends: Array.from({ length: n }, (_, i) => ({ keyword: `k${i}`, opportunity_score: i * 10 })),
  opportunities: Array.from({ length: n }, (_, i) => ({ keyword: `k${i}`, type: i % 2 ? "rising" : "gap" })),
  signals: [], competitor_movements: [], summary: null, stats: { avgOpportunityScore: 0, emergingTrends: 0 },
});

describe("lecture", () => {
  beforeEach(() => { vi.clearAllMocks(); m.role.current = "owner"; });

  it("chaque lecture est portée par l'organisation de la session", async () => {
    m.getMarketDashboard.mockResolvedValue(dash(2));
    await request(app("org-a")).get("/api/market-intelligence");
    await request(app("org-b")).get("/api/market-intelligence/trends");
    expect(m.getMarketDashboard.mock.calls.map(c => c[0])).toEqual(["org-a", "org-b"]);
  });
  it("trends : filtre min_score, borne limit à 1..100, ignore une valeur non numérique", async () => {
    m.getMarketDashboard.mockResolvedValue(dash(5));
    expect((await request(app()).get("/api/market-intelligence/trends?min_score=20")).body.count).toBe(3);
    expect((await request(app()).get("/api/market-intelligence/trends?limit=2")).body.count).toBe(2);
    expect((await request(app()).get("/api/market-intelligence/trends?limit=9999")).body.count).toBe(5);
    expect((await request(app()).get("/api/market-intelligence/trends?min_score=abc&limit=zzz")).body.count).toBe(5);
  });
  it("sans donnée : liste vide, source « no_data » (et non une panne)", async () => {
    m.getMarketDashboard.mockResolvedValue(dash(0));
    const r = await request(app()).get("/api/market-intelligence/opportunities");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ opportunities: [], count: 0, source: "no_data" });
  });
  it.each(["/api/market-intelligence", "/api/market-intelligence/trends", "/api/market-intelligence/opportunities", "/api/market-intelligence/competitor-movements", "/api/market-intelligence/signals"])(
    "%s : une panne de la base répond 503 MARKET_DATA_UNAVAILABLE, pas un succès vide", async (url) => {
      m.getMarketDashboard.mockRejectedValue(new Error("db down"));
      m.detectCompetitorMovements.mockRejectedValue(new Error("db down"));
      m.orgDb.mockRejectedValue(new Error("db down"));
      const r = await request(app()).get(url);
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("MARKET_DATA_UNAVAILABLE");
    });
  it("un rapport d'une autre organisation est introuvable (requête scopée)", async () => {
    m.orgDb.mockResolvedValue({ rows: [] });
    const r = await request(app("org-b")).get("/api/market-intelligence/reports/rep-of-org-a");
    expect(r.status).toBe(404);
    expect(m.orgDb.mock.calls[0]![1]).toEqual(["rep-of-org-a", "org-b"]);
  });
});

describe("écriture", () => {
  beforeEach(() => { vi.clearAllMocks(); m.role.current = "owner"; });
  it("la génération de rapport exige un rôle d'écriture", async () => {
    m.role.current = "viewer";
    const r = await request(app()).post("/api/market-intelligence/report/generate").send({});
    expect(r.status).toBe(403);
    expect(m.generateMarketReport).not.toHaveBeenCalled();
  });
  it("génère un rapport pour l'organisation de la session", async () => {
    m.generateMarketReport.mockResolvedValue({ id: "r1", org_id: "org-a" });
    const r = await request(app("org-a")).post("/api/market-intelligence/report/generate").send({});
    expect(r.status).toBe(200);
    expect(m.generateMarketReport).toHaveBeenCalledWith("org-a");
  });
  it("competitor-movement exige un domaine", async () => {
    expect((await request(app()).post("/api/market-intelligence/competitor-movement").send({})).status).toBe(400);
    expect(m.detectCompetitorMovements).not.toHaveBeenCalled();
  });
});
