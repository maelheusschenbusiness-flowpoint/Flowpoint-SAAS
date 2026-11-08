/**
 * GET /api/billing/verify — non-regression (2026-11-08), base Flowpoint (apres #402).
 *
 * 1. La propriete de la session est controlee AVANT la reponse « paiement non termine » :
 *    une session etrangere ne revele plus son statut (402 -> 403).
 * 2. Plus de plan « pro » par defaut : une session sans plan valide (ex. add-on seul)
 *    repond 422 PLAN_UNRESOLVED sans ecrire ni diffuser.
 * Les regles de #402 (403 si orgId/customer conflictuels ou sans lien) sont preservees.
 * Stripe, la base et le store sont mockes : aucun appel reseau, aucune donnee reelle.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeRetrieve = vi.fn();
const persistOrgData = vi.fn();
const broadcastPlanUpdate = vi.fn();
const loadBillingContext = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  withOrgDb: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
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

function session(over: Record<string, unknown> = {}) {
  return {
    id: "cs_test_ok123", status: "complete", payment_status: "paid", customer: CUS_A,
    metadata: { plan: "pro", addons: "{}" },
    subscription: { id: "sub_A", status: "trialing", trial_end: 1900000000 },
    ...over,
  };
}
const get = (id = "cs_test_ok123") => request(app).get(`/api/billing/verify?session_id=${id}`);
const aucuneEcriture = () => {
  expect(persistOrgData).not.toHaveBeenCalled();
  expect(broadcastPlanUpdate).not.toHaveBeenCalled();
};

beforeAll(async () => {
  const { default: billingRouter } = await import("./billing.js");
  app = express();
  app.use((req, _res, next) => { (req as unknown as { orgId: string }).orgId = ORG; next(); });
  app.use("/api", billingRouter);
});
beforeEach(() => {
  for (const m of [stripeRetrieve, persistOrgData, broadcastPlanUpdate, loadBillingContext]) m.mockReset();
  persistOrgData.mockResolvedValue(undefined);
  loadBillingContext.mockResolvedValue({ stripeCustomerId: CUS_A, trialEndsAt: null, stripeSubscriptionId: "sub_main", addons: {}, plan: "standard" });
});

describe("verify : preservation des regles d'appartenance de #402", () => {
  it("a) session d'une autre organisation (customer different) : 403, aucune ecriture ni broadcast", async () => {
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_B }));
    expect((await get()).status).toBe(403);
    aucuneEcriture();
  });
  it("b) metadata.orgId d'une autre organisation : 403 meme si le customer correspond", async () => {
    stripeRetrieve.mockResolvedValue(session({ metadata: { plan: "pro", orgId: "org-B" } }));
    expect((await get()).status).toBe(403);
    aucuneEcriture();
  });
  it("c) aucun lien (ni orgId ni customer connu) : 403", async () => {
    loadBillingContext.mockResolvedValue({ stripeCustomerId: null, trialEndsAt: null, stripeSubscriptionId: null, addons: {} });
    stripeRetrieve.mockResolvedValue(session());
    expect((await get()).status).toBe(403);
    aucuneEcriture();
  });
  it("client_reference_id seul n'est PAS une preuve d'appartenance : 403", async () => {
    loadBillingContext.mockResolvedValue({ stripeCustomerId: null, trialEndsAt: null, stripeSubscriptionId: null, addons: {} });
    stripeRetrieve.mockResolvedValue(session({ customer: null, client_reference_id: ORG }));
    expect((await get()).status).toBe(403);
    aucuneEcriture();
  });
});

describe("verify : pas de fuite du statut d'une session etrangere", () => {
  it("d) autre organisation NON PAYEE (status open) : 403, le corps ne contient pas `status`, aucune ecriture", async () => {
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_B, status: "open", payment_status: "unpaid" }));
    const r = await get();
    expect(r.status).toBe(403);
    expect(r.body).not.toHaveProperty("status");
    expect(JSON.stringify(r.body)).not.toContain("open");
    aucuneEcriture();
  });
  it("403 : code SESSION_NOT_OWNED present (additif)", async () => {
    stripeRetrieve.mockResolvedValue(session({ customer: CUS_B }));
    expect((await get()).body.code).toBe("SESSION_NOT_OWNED");
  });
  it("session non payee de l'organisation elle-meme : 402 inchange (avec statut)", async () => {
    stripeRetrieve.mockResolvedValue(session({ status: "open", payment_status: "unpaid" }));
    const r = await get();
    expect(r.status).toBe(402);
    expect(r.body.status).toBe("open");
    aucuneEcriture();
  });
});

describe("verify : plan sans defaut « pro »", () => {
  it("e) session d'ADD-ON SEUL de l'organisation (sans plan, org standard) : 422, ni plan ni souscription ecrits, pas de broadcast", async () => {
    stripeRetrieve.mockResolvedValue({
      id: "cs_test_addon1", status: "complete", payment_status: "paid", mode: "subscription", customer: CUS_A,
      metadata: { addonKey: "extraSeats", addonName: "Sieges", orgId: ORG, quantity: "2" },
      subscription: { id: "sub_addon", status: "active" },
    });
    const r = await get("cs_test_addon1");
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("PLAN_UNRESOLVED");
    aucuneEcriture();
  });
  it.each([[{ plan: "gold" }], [{ plan: "" }], [{}]])("f) plan invalide/vide/absent %j : 422 et aucune ecriture", async (meta) => {
    stripeRetrieve.mockResolvedValue(session({ metadata: meta }));
    const r = await get();
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("PLAN_UNRESOLVED");
    aucuneEcriture();
  });
});

describe("verify : comportement nominal inchange", () => {
  it.each(["standard", "pro", "ultra"])("g) session valide, plan %s : 200, plan et souscription ecrits, broadcast", async (plan) => {
    stripeRetrieve.mockResolvedValue(session({ metadata: { plan } }));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, plan });
    expect(broadcastPlanUpdate).toHaveBeenCalledWith(plan, ORG);
    expect(persistOrgData).toHaveBeenCalledWith(ORG, {
      plan, subscriptionStatus: "trialing", stripeCustomerId: CUS_A,
      stripeSubscriptionId: "sub_A", trialEndsAt: new Date(1900000000 * 1000).toISOString(),
    });
  });
  it("g bis) selected_plan prioritaire, insensible a la casse", async () => {
    stripeRetrieve.mockResolvedValue(session({ metadata: { selected_plan: "Ultra", plan: "pro" } }));
    expect((await get()).body.plan).toBe("ultra");
  });
  it("h) session AI credits de l'organisation : reponse inchangee, aucune ecriture de plan", async () => {
    stripeRetrieve.mockResolvedValue(session({ metadata: { type: "ai_credits", credits: "50000" } }));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, checkoutType: "ai_credits", credits: 50000 });
    aucuneEcriture();
  });
});

describe("verify : echecs Stripe (code HTTP actuel conserve, aucune ecriture)", () => {
  it("i) session inexistante (resource_missing) : 500 conserve, aucune ecriture", async () => {
    stripeRetrieve.mockRejectedValue(Object.assign(new Error("No such session"), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 }));
    expect((await get("cs_test_inconnue")).status).toBe(500);
    aucuneEcriture();
  });
  it("j) echec Stripe (connexion) : aucune ecriture", async () => {
    stripeRetrieve.mockRejectedValue(Object.assign(new Error("down"), { type: "StripeConnectionError" }));
    expect((await get()).status).toBe(500);
    aucuneEcriture();
  });
});
