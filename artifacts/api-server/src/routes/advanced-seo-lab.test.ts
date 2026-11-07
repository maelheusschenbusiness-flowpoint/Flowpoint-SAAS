import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  verifyQuota: vi.fn(),
  refundQuota: vi.fn(),
  getContentOptimization: vi.fn(),
  getTopKeywords: vi.fn(),
  generateSEOMissions: vi.fn(),
  loadBillingContext: vi.fn(),
  logActivity: vi.fn(),
  role: "owner",
  addonEnabled: true,
  paidCalls: 0,
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  getDBMode: vi.fn(() => "postgres"),
  getOrgDb: vi.fn(() => vi.fn()),
  queryWithRetry: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../services/store.js", () => ({
  store: { logActivity: (...args: unknown[]) => mocks.logActivity(...args) },
}));

vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: (...args: unknown[]) => mocks.loadBillingContext(...args),
}));

vi.mock("../services/gsc-service.js", () => ({
  getTopKeywords: (...args: unknown[]) => mocks.getTopKeywords(...args),
}));

vi.mock("../services/dataforseo-service.js", () => ({
  isDataForSEOConfigured: vi.fn(async () => true),
  verifierEtConsommerQuota: (...args: unknown[]) => mocks.verifyQuota(...args),
  rembourserQuota: (...args: unknown[]) => mocks.refundQuota(...args),
  suivreAppelsPayants: async (handler: () => Promise<unknown>) => ({
    resultat: await handler(),
    appelsReussis: mocks.paidCalls,
  }),
  getQuotaUsage: vi.fn(() => ({ used: 0, limit: 1000 })),
  getQuotaUsageFromDB: vi.fn(async () => ({ used: 0, limit: 1000 })),
  getKeywordSuggestions: vi.fn(),
  getSERP: vi.fn(),
  getCompetitors: vi.fn(),
  getBacklinks: vi.fn(),
  getBacklinkHistory: vi.fn(),
  getBacklinkDetails: vi.fn(),
  getDomainMetrics: vi.fn(),
  getKeywordDifficulty: vi.fn(),
  getLocalPackRank: vi.fn(),
  getGoogleMapsResults: vi.fn(),
  getAIVisibility: vi.fn(),
  getContentOptimization: (...args: unknown[]) => mocks.getContentOptimization(...args),
  generateSEOMissions: (...args: unknown[]) => mocks.generateSEOMissions(...args),
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: (addonKey: string, label: string) => (req: Request, res: Response, next: NextFunction) => {
    if (addonKey === "advancedSeoLab" && mocks.addonEnabled) { next(); return; }
    res.status(403).json({ error: `${label} required`, code: "ADDON_REQUIRED", addonKey });
  },
}));

import seoRouter from "./seo.js";

const ORG_ID = "advanced-seo-lab-test-org";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      orgId: ORG_ID,
      me: { plan: "standard" },
      orgContext: { role: mocks.role, userId: "advanced-seo-owner", email: "seo-owner@example.test" },
    });
    next();
  });
  app.use("/api", seoRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "owner";
  mocks.addonEnabled = true;
  mocks.paidCalls = 0;
  mocks.verifyQuota.mockResolvedValue({ autorise: true, utilise: 1, limite: 1000 });
  mocks.refundQuota.mockResolvedValue(undefined);
  mocks.loadBillingContext.mockResolvedValue({ addons: { advancedSeoLab: true } });
  mocks.logActivity.mockResolvedValue(undefined);
  mocks.getContentOptimization.mockImplementation(async () => {
    mocks.paidCalls += 1;
    return { score: 82, wordCount: 640, headings: 9, recommendations: ["Clarifier le titre de la page"] };
  });
  mocks.getTopKeywords.mockResolvedValue([{ keyword: "plombier urgence" }, { keyword: " " }]);
  mocks.generateSEOMissions.mockImplementation(async (_orgId: string, _domain: string, keywords: string[]) => {
    mocks.paidCalls += 1;
    return [{ keyword: keywords[0], difficulty: 22, volume: 410, actionPlan: ["Créer une page ciblée"] }];
  });
});

describe("Advanced SEO Lab — analyse de contenu et génération de missions", () => {
  it("retourne l'analyse DataForSEO pour un utilisateur autorisé et consigne l'action dans son organisation", async () => {
    const res = await request(makeApp())
      .post("/api/seo/content-optimization")
      .send({ url: "https://seo-test.example/page" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      score: 82,
      wordCount: 640,
      headings: 9,
      recommendations: ["Clarifier le titre de la page"],
    });
    expect(mocks.verifyQuota).toHaveBeenCalledWith(ORG_ID, "standard");
    expect(mocks.getContentOptimization).toHaveBeenCalledWith(
      "https://seo-test.example/page",
      "seo local",
      ORG_ID,
    );
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      targetId: "https://seo-test.example/page",
    }));
    expect(mocks.refundQuota).not.toHaveBeenCalled();
  });

  it("refuse un rôle viewer avant de réserver le quota ou d'appeler le fournisseur", async () => {
    mocks.role = "viewer";
    const res = await request(makeApp())
      .post("/api/seo/content-optimization")
      .send({ url: "https://seo-test.example/page" });

    expect(res.status).toBe(403);
    expect(mocks.verifyQuota).not.toHaveBeenCalled();
    expect(mocks.getContentOptimization).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur sans l'add-on et rembourse la réservation de quota", async () => {
    mocks.loadBillingContext.mockResolvedValue({ addons: { advancedSeoLab: false } });
    const res = await request(makeApp())
      .post("/api/seo/content-optimization")
      .send({ url: "https://seo-test.example/page" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "ADDON_REQUIRED", addonKey: "advancedSeoLab" });
    expect(mocks.getContentOptimization).not.toHaveBeenCalled();
    expect(mocks.refundQuota).toHaveBeenCalledWith(ORG_ID, 1);
  });

  it("bloque le fournisseur au plafond et ne rembourse pas un quota déjà refusé", async () => {
    mocks.verifyQuota.mockResolvedValue({
      autorise: false,
      motif: "plafond",
      utilise: 1000,
      limite: 1000,
    });
    const res = await request(makeApp())
      .post("/api/seo/content-optimization")
      .send({ url: "https://seo-test.example/page" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ used: 1000, limit: 1000 });
    expect(mocks.getContentOptimization).not.toHaveBeenCalled();
    expect(mocks.refundQuota).not.toHaveBeenCalled();
  });

  it("rembourse le quota si DataForSEO n'est pas configuré et ne présente aucune métrique fictive", async () => {
    mocks.getContentOptimization.mockRejectedValue(Object.assign(
      new Error("not configured"),
      { code: "DATAFORSEO_NOT_CONFIGURED" },
    ));
    const res = await request(makeApp())
      .post("/api/seo/content-optimization")
      .send({ url: "https://seo-test.example/page" });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, code: "DATAFORSEO_NOT_CONFIGURED" });
    expect(res.body.score).toBeUndefined();
    expect(mocks.refundQuota).toHaveBeenCalledWith(ORG_ID, 1);
  });

  it("génère des recommandations depuis les mots-clés GSC de la bonne organisation", async () => {
    const res = await request(makeApp())
      .post("/api/seo/generate-missions")
      .send({ domain: "seo-test.example" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      domain: "seo-test.example",
      missions: [{ keyword: "plombier urgence", difficulty: 22, volume: 410 }],
    });
    expect(mocks.getTopKeywords).toHaveBeenCalledWith(ORG_ID, 20, 28);
    expect(mocks.generateSEOMissions).toHaveBeenCalledWith(
      ORG_ID,
      "seo-test.example",
      ["plombier urgence"],
    );
  });

  it("refuse la génération des missions si l'add-on manque", async () => {
    mocks.addonEnabled = false;
    const res = await request(makeApp())
      .post("/api/seo/generate-missions")
      .send({ domain: "seo-test.example" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "ADDON_REQUIRED", addonKey: "advancedSeoLab" });
    expect(mocks.verifyQuota).not.toHaveBeenCalled();
    expect(mocks.generateSEOMissions).not.toHaveBeenCalled();
  });

  it("bloque la génération des missions au plafond DataForSEO avant toute lecture GSC", async () => {
    mocks.verifyQuota.mockResolvedValue({
      autorise: false,
      motif: "plafond",
      utilise: 1000,
      limite: 1000,
    });
    const res = await request(makeApp())
      .post("/api/seo/generate-missions")
      .send({ domain: "seo-test.example" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ used: 1000, limit: 1000 });
    expect(mocks.getTopKeywords).not.toHaveBeenCalled();
    expect(mocks.generateSEOMissions).not.toHaveBeenCalled();
    expect(mocks.refundQuota).not.toHaveBeenCalled();
  });

  it("valide le domaine et ne tente aucun appel si les mots-clés GSC manquent", async () => {
    const invalid = await request(makeApp()).post("/api/seo/generate-missions").send({ domain: "x".repeat(254) });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_DOMAIN");
    expect(mocks.verifyQuota).toHaveBeenCalledOnce();
    expect(mocks.refundQuota).toHaveBeenCalledWith(ORG_ID, 1);

    mocks.verifyQuota.mockClear();
    mocks.refundQuota.mockClear();
    mocks.getTopKeywords.mockResolvedValue([]);
    const empty = await request(makeApp()).post("/api/seo/generate-missions").send({ domain: "seo-test.example" });
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe("SEO_KEYWORDS_UNAVAILABLE");
    expect(mocks.verifyQuota).toHaveBeenCalledOnce();
    expect(mocks.refundQuota).toHaveBeenCalledWith(ORG_ID, 1);
    expect(mocks.generateSEOMissions).not.toHaveBeenCalled();
  });
});
