import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgDb: vi.fn(),
  aiChat: vi.fn(),
  checkAIQuota: vi.fn(),
  recordCompletedUsageDeferred: vi.fn(),
  loadOrgAIPrefs: vi.fn(),
  resolveAIModel: vi.fn(),
  buildQuotaGuidance: vi.fn(),
  addonAllowed: true,
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  trackedKeywordsTable: {},
  eq: vi.fn(),
}));
vi.mock("../services/keyword-engine.js", () => ({
  trackKeyword: vi.fn(),
  syncOrgRankings: vi.fn(),
  getRankingHistory: vi.fn(),
  getKeywordStats: vi.fn(),
  generateClusters: vi.fn(),
  generateOpportunities: vi.fn(),
  getAIRecommendations: vi.fn(),
  getKeywordLimit: vi.fn(),
}));
vi.mock("../services/ai-provider.js", () => ({ aiChat: mocks.aiChat }));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: mocks.loadOrgAIPrefs,
  resolveAIModel: mocks.resolveAIModel,
}));
vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: mocks.checkAIQuota,
  recordCompletedUsageDeferred: mocks.recordCompletedUsageDeferred,
}));
vi.mock("../services/ai-quota.js", () => ({ buildQuotaGuidance: mocks.buildQuotaGuidance }));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, res: any, next: any) => {
    if (!mocks.addonAllowed) {
      res.status(402).json({ error: "addon_gate_blocked" });
      return;
    }
    next();
  },
}));

import keywordsRouter from "./keywords.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: "org-a",
      userId: "user-a",
      orgDb: mocks.orgDb,
      me: { plan: "Pro" },
    });
    next();
  });
  app.use("/api", keywordsRouter);
  return app;
}

function pageRows(page: string, declining = true) {
  const now = Date.now();
  return [
    {
      page,
      date: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      clicks: 100,
      impressions: 1_000,
      position: 4,
    },
    {
      page,
      date: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      clicks: declining ? 50 : 100,
      impressions: 900,
      position: declining ? 8 : 4,
    },
  ];
}

describe("SEO Content Decay Radar routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addonAllowed = true;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STRIPE_TEST_MODE", "true");
    mocks.checkAIQuota.mockResolvedValue({ allowed: true });
    mocks.loadOrgAIPrefs.mockResolvedValue({});
    mocks.resolveAIModel.mockReturnValue({ provider: "openai", model: "gpt-4o-mini", maxTokens: 500 });
    mocks.aiChat.mockResolvedValue({
      text: JSON.stringify({
        summary: "La page perd des clics et des positions.",
        actions: [
          { title: "Vérifier le titre", reason: "Le CTR a baissé.", validation: "Comparer le CTR après mise à jour." },
          { title: "Actualiser la page", reason: "La position moyenne recule.", validation: "Comparer les positions dans GSC." },
          { title: "Renforcer les liens internes", reason: "La page perd en visibilité.", validation: "Suivre impressions et clics." },
        ],
      }),
      usage: { promptTokens: 60, completionTokens: 40 },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns only organization-scoped GSC measurements and derived opportunities", async () => {
    const rows = pageRows("https://site.example/guide");
    mocks.orgDb.mockResolvedValue({ rows });

    const response = await request(makeApp()).get("/api/keywords/content-decay");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      source: "google_search_console",
    });
    expect(response.body.opportunities[0]).toMatchObject({
      page: "https://site.example/guide",
      previous: { clicks: 100, impressions: 1_000 },
      current: { clicks: 50, impressions: 900 },
      lostClicks: 50,
      lostImpressions: 100,
      ctrDrop: expect.any(Number),
      reasons: ["clicks_declining", "ctr_declining", "ranking_declining"],
    });
    expect(mocks.orgDb).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND date >= $2 AND date < $3"),
      expect.arrayContaining(["org-a"]),
    );
  });

  it("returns no opportunities when the organization has no measured GSC rows", async () => {
    mocks.orgDb.mockResolvedValue({ rows: [] });

    const response = await request(makeApp()).get("/api/keywords/content-decay");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      source: "google_search_console",
      opportunities: [],
    });
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });

  it("does not turn a GSC database failure into an empty success response", async () => {
    mocks.orgDb.mockRejectedValue(new Error("GSC data query unavailable"));

    const response = await request(makeApp()).get("/api/keywords/content-decay");

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.body.ok).not.toBe(true);
    expect(response.body.opportunities).toBeUndefined();
  });

  it("generates a strategy only for an observed page opportunity", async () => {
    const page = "https://site.example/guide";
    mocks.orgDb.mockResolvedValue({ rows: pageRows(page) });

    const response = await request(makeApp())
      .post("/api/keywords/content-decay/strategy")
      .send({ page });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      source: "google_search_console",
      page,
      strategy: { summary: "La page perd des clics et des positions." },
    });
    expect(mocks.orgDb).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND page = $2"),
      expect.arrayContaining(["org-a", page]),
    );
    expect(mocks.checkAIQuota).toHaveBeenCalledWith({ feature: "strategist", orgId: "org-a" });
    expect(mocks.recordCompletedUsageDeferred).toHaveBeenCalledWith(expect.objectContaining({
      feature: "strategist",
      orgId: "org-a",
      userId: "user-a",
      success: true,
    }));
  });

  it("does not invoke AI when the page has no measured decline", async () => {
    const page = "https://site.example/stable";
    mocks.orgDb.mockResolvedValue({ rows: pageRows(page, false) });

    const response = await request(makeApp())
      .post("/api/keywords/content-decay/strategy?simulateAddon=1")
      .send({ page });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Aucune baisse mesurable/i);
    expect(mocks.checkAIQuota).not.toHaveBeenCalled();
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });

  it("does not bypass the add-on gate with the simulation query flag", async () => {
    mocks.addonAllowed = false;
    const getResponse = await request(makeApp()).get("/api/keywords/content-decay?simulateAddon=1");
    const postResponse = await request(makeApp())
      .post("/api/keywords/content-decay/strategy?simulateAddon=1")
      .send({ page: "https://site.example/guide" });

    expect(getResponse.status).toBe(402);
    expect(postResponse.status).toBe(402);
    expect(getResponse.body).toEqual({ error: "addon_gate_blocked" });
    expect(postResponse.body).toEqual({ error: "addon_gate_blocked" });
    expect(mocks.orgDb).not.toHaveBeenCalled();
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });
});
