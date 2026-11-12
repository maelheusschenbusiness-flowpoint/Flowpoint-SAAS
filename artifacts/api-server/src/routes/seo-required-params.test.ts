/**
 * Routes /seo/* : aucun parametre manquant n'est remplace par une valeur d'exemple
 * (« exemple.fr », « seo local », « restaurant », « Paris »). Une requete incomplete recoit 400
 * AVANT tout appel fournisseur paye ; aucune reponse d'erreur ne divulgue de detail interne.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const m = vi.hoisted(() => ({
  svc: Object.fromEntries(["getKeywordSuggestions", "getSERP", "getCompetitors", "getBacklinks", "getBacklinkHistory", "getBacklinkDetails",
    "getDomainMetrics", "getKeywordDifficulty", "getLocalPackRank", "getGoogleMapsResults", "getAIVisibility", "getContentOptimization",
    "generateSEOMissions"].map(k => [k, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>,
  orgDb: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../services/dataforseo-service.js", () => ({
  ...m.svc,
  isDataForSEOConfigured: vi.fn(async () => true),
  verifierEtConsommerQuota: vi.fn(async () => ({ autorise: true, utilise: 1, limite: 1000 })),
  rembourserQuota: vi.fn(async () => undefined),
  suivreAppelsPayants: async (fn: () => Promise<unknown>) => ({ resultat: await fn(), appelsReussis: 1 }),
  getQuotaUsage: vi.fn(), getQuotaUsageFromDB: vi.fn(async () => ({ used: 0, limit: 1000, resetAt: "x" })),
}));
vi.mock("../services/llm-visibility.js", () => ({ checkLLMVisibility: vi.fn() }));
vi.mock("../services/gsc-service.js", () => ({ getTopKeywords: vi.fn(async () => []) }));
vi.mock("../services/store.js", () => ({ store: { logActivity: vi.fn(async () => undefined) } }));
vi.mock("../services/billing-context.js", () => ({ loadBillingContext: vi.fn(async () => ({ addons: { advancedSeoLab: true, backlinkIntelligence: true } })) }));
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_a: unknown, _b: unknown, n: () => void) => n(), resolvePlanFromDB: async () => "pro" }));
vi.mock("../middlewares/requireRole.js", () => ({ canWrite: (_a: unknown, _b: unknown, n: () => void) => n(), canAdmin: (_a: unknown, _b: unknown, n: () => void) => n() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import router from "./seo.js";

const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { Object.assign(req, { orgId: "org-a", orgDb: m.orgDb }); next(); });
  a.use("/api", router);
  return a;
};
const providerCalls = () => Object.values(m.svc).reduce((n, f) => n + f.mock.calls.length, 0);

describe("paramètres obligatoires des routes /seo", () => {
  beforeEach(() => { vi.clearAllMocks(); m.orgDb.mockResolvedValue({ rows: [] }); for (const f of Object.values(m.svc)) f.mockResolvedValue([]); });

  it.each([
    ["/api/seo/keywords", "keyword"], ["/api/seo/serp", "keyword"], ["/api/seo/competitors", "domain"], ["/api/seo/domain-metrics", "domain"],
    ["/api/seo/keyword-difficulty", "keyword"], ["/api/seo/local-rank?keyword=plombier", "location"], ["/api/seo/local-rank?location=Lyon", "keyword"],
    ["/api/seo/maps?keyword=plombier", "location"], ["/api/seo/ai-mentions", "keyword"],
  ])("%s sans %s : 400, aucun appel fournisseur", async (url, param) => {
    const r = await request(app()).get(url);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "MISSING_PARAMETER", parameter: param });
    expect(providerCalls()).toBe(0);
  });

  it("une valeur vide, blanche ou démesurée est refusée comme une valeur absente", async () => {
    for (const q of ["domain=", "domain=%20%20", `domain=${"a".repeat(300)}`]) {
      expect((await request(app()).get(`/api/seo/domain-metrics?${q}`)).status).toBe(400);
    }
    expect(providerCalls()).toBe(0);
  });

  it("avec le paramètre fourni, le fournisseur reçoit exactement la valeur du client", async () => {
    m.svc["getDomainMetrics"]!.mockResolvedValue({ rank: 1 });
    const r = await request(app()).get("/api/seo/domain-metrics?domain=%20client-reel.fr%20");
    expect(r.status).toBe(200);
    expect(m.svc["getDomainMetrics"]).toHaveBeenCalledWith("client-reel.fr", "org-a");
  });

  it("langue et pays par défaut (fr / France) restent appliqués : ce sont des préférences, pas des données", async () => {
    await request(app()).get("/api/seo/keywords?keyword=agence");
    expect(m.svc["getKeywordSuggestions"]).toHaveBeenCalledWith("agence", "France", "fr", "org-a");
  });

  it("une erreur fournisseur ne divulgue aucun détail interne", async () => {
    m.svc["getSERP"]!.mockRejectedValue(new Error("secret-token=abc https://api.interne/x"));
    const r = await request(app()).get("/api/seo/serp?keyword=agence");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secret|interne|detail/);
  });
});

describe("POST /seo/content-optimization : mot-clé cible", () => {
  beforeEach(() => { vi.clearAllMocks(); m.svc["getContentOptimization"]!.mockResolvedValue({ score: 80, wordCount: 500, headings: 5, recommendations: [] }); });

  it("n'évalue jamais la page contre « seo local » : sans mot-clé ni suivi, 422 sans appel fournisseur", async () => {
    m.orgDb.mockResolvedValue({ rows: [] });
    const r = await request(app()).post("/api/seo/content-optimization").send({ url: "https://client.fr/page" });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("KEYWORD_REQUIRED");
    expect(m.svc["getContentOptimization"]).not.toHaveBeenCalled();
  });
  it("utilise le mot-clé fourni", async () => {
    await request(app()).post("/api/seo/content-optimization").send({ url: "https://client.fr/page", keyword: "  plomberie urgence " });
    expect(m.svc["getContentOptimization"]).toHaveBeenCalledWith("https://client.fr/page", "plomberie urgence", "org-a");
  });
  it("à défaut, utilise le mot-clé suivi de l'organisation ayant le plus de volume (requête scopée)", async () => {
    m.orgDb.mockResolvedValue({ rows: [{ keyword: "chauffagiste lyon" }] });
    await request(app()).post("/api/seo/content-optimization").send({ url: "https://client.fr/page" });
    expect(m.svc["getContentOptimization"]).toHaveBeenCalledWith("https://client.fr/page", "chauffagiste lyon", "org-a");
    expect(m.orgDb.mock.calls[0]![1]).toEqual(["org-a"]);
  });
  it("le code ne contient plus de valeur d'exemple", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/seo.ts"), "utf8");
    expect(src).not.toMatch(/"exemple\.fr"|= "seo local"|, "seo local"|= "restaurant"|= "Paris"|detail: String\(/);
  });

  it("le client n'injecte plus de mot-clé ni de ville d'exemple (« seo », « Paris »)", () => {
    const src = readFileSync(join(process.cwd(), "../flowpoint-export/fp-backend.js"), "utf8");
    expect(src).not.toMatch(/keyword \|\| 'seo'|location \|\| 'Paris'/);
  });
});
