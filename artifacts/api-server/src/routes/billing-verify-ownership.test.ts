/**
 * GET /api/billing/verify — correctif de securite (2026-11-08).
 *
 * Avant : n'importe quel session_id Stripe etait relu puis ecrit sur l'organisation
 * appelante (plan / customer / souscription) ; une session inexistante repondait 500 ;
 * un plan absent retombait silencieusement sur "pro".
 * Stripe, la base et le store sont mockes : aucun appel reseau, aucune donnee reelle.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeRetrieve = vi.fn();
const persistOrgData = vi.fn();
const broadcastPlanUpdate = vi.fn();
const loadBillingContext = vi.fn();
const poolQuery = vi.fn();
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@workspace/db", () => ({
  pool: { query: (...a: unknown[]) => poolQuery(...a), connect: vi.fn() },
  withOrgDb: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: logs.info, warn: logs.warn, error: logs.error, debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/stripe-factory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/stripe-factory.js")>()),
  createStripeClient: async () => ({ checkout: { sessions: { retrieve: (...a: unknown[]) => stripeRetrieve(...a) } } }),
  getStripeKey: () => "sk_test_fictive",
  getStripeCheckoutModeLog: () => ({}),
  getPublishableKey: () => "pk_test_fictive",
}));
vi.mock("../services/billing-context.js", () => ({ loadBillingContext: (...a: unknown[]) => loadBillingContext(...a) }));
vi.mock("../services/org-data.js", () => ({
  persistOrgData: (...a: unknown[]) => persistOrgData(...a),
  loadOrgData: vi.fn(),
  findOrgByStripeCustomer: vi.fn(),
}));
vi.mock("../services/store.js", () => ({ store: { broadcastPlanUpdate: (...a: unknown[]) => broadcastPlanUpdate(...a) } }));

import express from "express";
import request from "supertest";

const ORG = "org-A";
const CUS_A = "cus_AAAA";
const CUS_B = "cus_BBBB";
let app: express.Express;

function stripeError(type: string, code: string | undefined, statusCode: number) {
  return Object.assign(new Error("No such checkout.session: 'cs_test_secretdata'"), { type, code, statusCode });
}
function session(over: Record<string, unknown> = {}) {
  return {
    id: "cs_test_ok123", mode: "subscription", status: "complete", payment_status: "paid", customer: CUS_A,
    metadata: { plan: "pro", addons: "{}" },
    subscription: { id: "sub_A", status: "trialing", trial_end: 1900000000 },
    ...over,
  };
}
const get = (id = "cs_test_ok123") => request(app).get(`/api/billing/verify?session_id=${id}`);

beforeAll(async () => {
  const { default: billingRouter } = await import("./billing.js");
  app = express();
  app.use((req, _res, next) => { (req as unknown as { orgId: string }).orgId = ORG; next(); });
  app.use("/api", billingRouter);
});
beforeEach(() => {
  for (const m of [stripeRetrieve, persistOrgData, broadcastPlanUpdate, loadBillingContext, poolQuery, logs.info, logs.warn, logs.error]) m.mockReset();
  persistOrgData.mockResolvedValue(undefined);
  // Registre d'achats de credits IA (version integration) : 50 000 credits lies a la session et a l'organisation.
  poolQuery.mockResolvedValue({ rows: [{ credits: "50000" }] });
  loadBillingContext.mockResolvedValue({ stripeCustomerId: CUS_A, trialEndsAt: null, stripeSubscriptionId: null, addons: {} });
});

describe("GET /billing/verify : propriete de la session", () => {
  it("session d'une AUTRE organisation (customer different) : 403, aucune ecriture ni broadcast", async () => {
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_B }));
    const r = await get();
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("SESSION_NOT_OWNED");
    expect(persistOrgData).not.toHaveBeenCalled();
    expect(broadcastPlanUpdate).not.toHaveBeenCalled();
    expect(logs.warn).toHaveBeenCalled();
  });

  it("metadata.orgId d'une autre organisation : 403 sans ecriture, meme si le customer correspond", async () => {
    stripeRetrieve.mockResolvedValue(session({ metadata: { plan: "pro", orgId: "org-B" } }));
    const r = await get();
    expect(r.status).toBe(403);
    expect(persistOrgData).not.toHaveBeenCalled();
    expect(broadcastPlanUpdate).not.toHaveBeenCalled();
  });

  it("session d'une autre organisation dont le paiement est incomplet : 403 (pas de fuite du statut)", async () => {
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_B, status: "open", payment_status: "unpaid" }));
    expect((await get()).status).toBe(403);
  });

  it("session AI credits d'une autre organisation : 403, aucun credit annonce", async () => {
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_B, metadata: { type: "ai_credits", credits: "50000" } }));
    const r = await get();
    expect(r.status).toBe(403);
    expect(r.body.credits).toBeUndefined();
  });

  it("session sans aucun lien avec l'organisation (ni customer connu ni orgId) : 403", async () => {
    loadBillingContext.mockResolvedValue({ stripeCustomerId: null, trialEndsAt: null, stripeSubscriptionId: null, addons: {} });
    stripeRetrieve.mockResolvedValue(session());
    expect((await get()).status).toBe(403);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("session valide de l'organisation (customer) : plan, essai et souscription ecrits comme avant", async () => {
    stripeRetrieve.mockResolvedValue(session());
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, plan: "pro" });
    expect(broadcastPlanUpdate).toHaveBeenCalledWith("pro", ORG);
    expect(persistOrgData).toHaveBeenCalledWith(ORG, {
      plan: "pro", subscriptionStatus: "trialing", stripeCustomerId: CUS_A,
      stripeSubscriptionId: "sub_A", trialEndsAt: new Date(1900000000 * 1000).toISOString(),
    });
  });

  it("session valide reconnue par metadata.orgId seul : acceptee", async () => {
    loadBillingContext.mockResolvedValue({ stripeCustomerId: null, trialEndsAt: null, stripeSubscriptionId: null, addons: {} });
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_A, metadata: { selected_plan: "Ultra", orgId: ORG } }));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.plan).toBe("ultra");
  });

  it("session AI credits de l'organisation : reponse inchangee, aucune ecriture de plan", async () => {
    stripeRetrieve.mockResolvedValue(session({ metadata: { type: "ai_credits", credits: "50000" } }));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, checkoutType: "ai_credits" });
    expect(persistOrgData).not.toHaveBeenCalled();
  });
});

describe("GET /billing/verify : erreurs Stripe typees", () => {
  it("session inexistante (resource_missing) : 404 SESSION_NOT_FOUND, jamais 500, cause sans donnees", async () => {
    stripeRetrieve.mockRejectedValue(stripeError("StripeInvalidRequestError", "resource_missing", 404));
    const r = await get("cs_test_inconnue");
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("SESSION_NOT_FOUND");
    expect(persistOrgData).not.toHaveBeenCalled();
    const journal = JSON.stringify(logs.warn.mock.calls) + JSON.stringify(logs.error.mock.calls);
    expect(journal).toContain("resource_missing");
    expect(journal).not.toContain("cs_test_secretdata");
    expect(journal).not.toContain("cs_test_inconnue");
  });

  it("identifiant mal forme : 400 sans appeler Stripe", async () => {
    const r = await get("../customers");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_SESSION_ID");
    expect(stripeRetrieve).not.toHaveBeenCalled();
  });

  it("Stripe injoignable : 503 STRIPE_UNAVAILABLE", async () => {
    stripeRetrieve.mockRejectedValue(stripeError("StripeConnectionError", undefined, undefined as never));
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("STRIPE_UNAVAILABLE");
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("erreur 5xx cote Stripe : 502 STRIPE_UNAVAILABLE", async () => {
    stripeRetrieve.mockRejectedValue(stripeError("StripeAPIError", undefined, 500));
    const r = await get();
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("STRIPE_UNAVAILABLE");
  });
});

describe("GET /billing/verify : plan sans defaut silencieux", () => {
  it.each([[{}], [{ plan: "gold" }], [{ selected_plan: "", plan: "" }]])("metadonnees de plan %j : 422, rien d'ecrit ni diffuse", async (meta) => {
    stripeRetrieve.mockResolvedValue(session({ metadata: meta }));
    const r = await get();
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("PLAN_UNRESOLVED");
    expect(persistOrgData).not.toHaveBeenCalled();
    expect(broadcastPlanUpdate).not.toHaveBeenCalled();
  });
});
