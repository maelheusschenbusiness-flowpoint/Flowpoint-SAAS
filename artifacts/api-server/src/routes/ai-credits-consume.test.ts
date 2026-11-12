/**
 * POST /ai-credits/consume (constat 2) et POST /addons/ai-credits/buy (constat 1).
 * Avant correction : consume n'avait aucune garde d'abonnement ni de role, acceptait n'importe quel
 * « feature » et un utilisateur-cle API ; buy repondait `ok:true, creditsAdded` sans paiement.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumeMock, paidMock, broadcastMock } = vi.hoisted(() => ({
  consumeMock: vi.fn(), paidMock: vi.fn(), broadcastMock: vi.fn(),
}));

vi.mock("../services/ai-engine.js", () => ({
  getAIUsageStats: vi.fn(),
  consumeAICredits: consumeMock,
  AI_FEATURES: ["chat", "strategist", "report_gen", "mission_auto", "cro_analysis", "forecast",
    "market_intel", "behavior_analysis", "revenue_leak", "audit_summary", "overview_insights"],
}));
vi.mock("../middlewares/requirePaidAccess.js", () => ({ enforcePaidAccess: paidMock }));
vi.mock("../services/store.js", () => ({ store: { broadcast: broadcastMock, logActivity: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(), deactivateAddon: vi.fn(), getOrgAddons: vi.fn(), getQuotaLimits: vi.fn(),
  ADDON_DEFINITIONS: {}, addExtraAICredits: vi.fn(async () => 50000),
}));
vi.mock("../services/org-data.js", () => ({ loadOrgData: vi.fn() }));
vi.mock("../middlewares/requireRole.js", () => ({ ownerOnly: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../services/stripe-factory.js", () => ({ getStripeKey: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import aiCreditsRouter from "./ai-credits.js";
import addonsRouter from "./addons.js";

function makeApp(ctx: Record<string, unknown> | null, orgId: string | undefined = "org-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId, userId: (ctx as { userId?: string } | null)?.userId, orgContext: ctx ?? undefined });
    next();
  });
  app.use("/api", aiCreditsRouter);
  app.use("/api", addonsRouter);
  return app;
}
const member = { orgId: "org-a", userId: "user-1", email: "u@example.test", role: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  paidMock.mockResolvedValue(true);
  consumeMock.mockResolvedValue({ allowed: true, creditsUsed: 600, remaining: 1000 });
});

describe("POST /ai-credits/consume — garde", () => {
  it("401 sans contexte d'organisation (aucun debit)", async () => {
    const res = await request(makeApp(null, "default")).post("/api/ai-credits/consume").send({ feature: "chat" });
    expect(res.status).toBe(401);
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("403 pour une cle API (fp_pub_/fp_sec_) et pour le credential de service", async () => {
    for (const userId of ["apikey:org-a", "service"]) {
      const res = await request(makeApp({ orgId: "org-a", userId, role: "admin" })).post("/api/ai-credits/consume").send({ feature: "chat" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("HUMAN_USER_REQUIRED");
    }
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("403 pour un viewer", async () => {
    const res = await request(makeApp({ ...member, role: "viewer" })).post("/api/ai-credits/consume").send({ feature: "chat" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ROLE_NOT_ALLOWED");
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("refuse (402) quand l'abonnement n'ouvre pas l'acces payant : aucun debit", async () => {
    paidMock.mockImplementation(async (_req: unknown, res: express.Response) => {
      res.status(402).json({ code: "SUBSCRIPTION_REQUIRED" }); return false;
    });
    const res = await request(makeApp(member)).post("/api/ai-credits/consume").send({ feature: "chat" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it.each([[undefined], ["inconnue"], [123], ["__proto__"]])("400 feature invalide (%s)", async (feature) => {
    const res = await request(makeApp(member)).post("/api/ai-credits/consume").send({ feature });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FEATURE");
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("400 metadata trop grande ou non-objet", async () => {
    for (const metadata of ["x", [1], { a: "x".repeat(3000) }]) {
      const res = await request(makeApp(member)).post("/api/ai-credits/consume").send({ feature: "chat", metadata });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_METADATA");
    }
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("400 Idempotency-Key malformee", async () => {
    const res = await request(makeApp(member)).post("/api/ai-credits/consume").set("Idempotency-Key", "a b").send({ feature: "chat" });
    expect(res.status).toBe(400);
    expect(consumeMock).not.toHaveBeenCalled();
  });
});

describe("POST /ai-credits/consume — debit", () => {
  it("debite pour l'organisation DE LA SESSION, jamais celle (ni le montant) fournie par le client", async () => {
    const res = await request(makeApp(member)).post("/api/ai-credits/consume")
      .set("Idempotency-Key", "abcdef123456")
      .send({ feature: "audit_summary", orgId: "org-victime", credits: -99999, amount: 1, creditsUsed: -5, metadata: { page: "x" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, allowed: true, creditsUsed: 600 });
    expect(consumeMock).toHaveBeenCalledTimes(1);
    const arg = consumeMock.mock.calls[0]![0];
    expect(arg.orgId).toBe("org-a");
    expect(arg.userId).toBe("user-1");
    expect(arg.feature).toBe("audit_summary");
    expect(arg).not.toHaveProperty("credits");
    expect(arg).not.toHaveProperty("fixedCreditCost");
    expect(arg.requestId).toBe("consume:user-1:abcdef123456");
    // journal : provenance posee par le serveur, metadonnees client isolees
    expect(arg.metadata).toMatchObject({ source: "api:/ai-credits/consume", role: "member", clientMetadata: { page: "x" } });
  });

  it("402 AI_CREDITS_EXHAUSTED au plafond", async () => {
    consumeMock.mockResolvedValue({ allowed: false, creditsUsed: 0, remaining: 120, reason: "quota_exhausted" });
    const res = await request(makeApp(member)).post("/api/ai-credits/consume").send({ feature: "chat" });
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ ok: false, code: "AI_CREDITS_EXHAUSTED", remaining: 120 });
  });

  it("503 retryable quand le suivi est indisponible (fail-closed)", async () => {
    consumeMock.mockResolvedValue({ allowed: false, creditsUsed: 0, remaining: 0, reason: "unavailable" });
    const res = await request(makeApp(member)).post("/api/ai-credits/consume").send({ feature: "chat" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_USAGE_UNAVAILABLE");
  });
});

describe("POST /addons/ai-credits/buy — aucun credit sans paiement", () => {
  it("repond 402 PAYMENT_REQUIRED, creditsAdded=0, sans diffuser d'evenement de credit", async () => {
    const res = await request(makeApp({ ...member, role: "owner" })).post("/api/addons/ai-credits/buy").send({ pack: "500k" });
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED", creditsAdded: 0, pack: "500k" });
    expect(res.body.checkout.inApp).toBe("/api/billing/ai-credits-intent");
    expect(res.body.checkout.pack).toBe("ai_credits_500k");
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it("pack inconnu : 400", async () => {
    const res = await request(makeApp({ ...member, role: "owner" })).post("/api/addons/ai-credits/buy").send({ pack: "1m" });
    expect(res.status).toBe(400);
  });
});
