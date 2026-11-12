/**
 * GET /billing/verify — seule une session d'abonnement à un plan, appartenant à
 * l'organisation authentifiée, peut écrire le plan ou la souscription.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { PLAN_PRICE_IDS } from "../lib/plans.js";

const persistOrgData = vi.fn().mockResolvedValue(undefined);
const broadcastPlanUpdate = vi.fn();
const retrieve = vi.fn();
let ctx: Record<string, unknown> = {};
let ledgerCredits = 0;
const poolQuery = vi.fn(async () => ({ rows: [{ credits: String(ledgerCredits) }] }));

vi.mock("../services/stripe-factory.js", async (orig) => ({
  ...(await orig<object>()),
  getStripeKey: () => "sk_test_unit",
  getPublishableKey: () => "pk_test_unit",
  getStripeCheckoutModeLog: () => ({}),
  createStripeClient: async () => ({ checkout: { sessions: { retrieve } } }),
}));
vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: async (orgId: string) =>
    orgId === "org-a" ? { ...ctx } : { stripeCustomerId: "cus_other", addons: {} },
}));
vi.mock("../services/org-data.js", () => ({
  persistOrgData: (...a: unknown[]) => persistOrgData(...a),
  loadOrgData: vi.fn().mockResolvedValue({}),
  findOrgByStripeCustomer: vi.fn(),
}));
vi.mock("../services/store.js", () => ({ store: { broadcastPlanUpdate: (...a: unknown[]) => broadcastPlanUpdate(...a) } }));
vi.mock("@workspace/db", async (orig) => ({ ...(await orig<object>()), pool: { query: (...a: unknown[]) => poolQuery(...(a as [])) } }));
vi.mock("../services/mailer.js", () => ({ mailer: {} }));
vi.mock("../services/sessions.js", () => ({ getSession: vi.fn(), invalidateAllSessions: vi.fn() }));

import billingRouter from "./billing.js";

const sub = (id: string, plan: "standard" | "pro" | "ultra" | "addon", status = "active") => ({
  id, status, trial_end: null, metadata: plan === "addon" ? {} : { plan },
  items: { data: [{ price: { id: plan === "addon" ? "price_addon_x" : PLAN_PRICE_IDS[plan] } }] },
});
const paid = { payment_status: "paid", status: "complete", customer: "cus_a" };

describe("GET /billing/verify — aucune écriture de plan hors achat de plan", () => {
  const app = express();
  let server: ReturnType<typeof app.listen>;
  let base = "";
  beforeAll(async () => {
    app.use((req, _res, next) => { (req as any).orgId = String(req.headers["x-org"] ?? ""); next(); });
    app.use("/api", billingRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(r => server.once("listening", r));
    const a = server.address();
    if (a && typeof a !== "string") base = `http://127.0.0.1:${a.port}`;
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
  beforeEach(() => {
    persistOrgData.mockClear(); broadcastPlanUpdate.mockClear(); retrieve.mockReset(); ledgerCredits = 0;
    ctx = { stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_main", subscriptionStatus: "active", plan: "standard", addons: {} };
  });
  const call = async (session: Record<string, unknown>, org = "org-a") => {
    retrieve.mockResolvedValueOnce(session);
    const r = await fetch(`${base}/api/billing/verify?session_id=cs_test_unit`, { headers: { "x-org": org } });
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  const planWrites = () => persistOrgData.mock.calls.filter(c => (c[1] as Record<string, unknown>)?.plan !== undefined);

  it("add-on seul (/billing/addon-checkout) : aucun plan ni souscription écrits", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_addon", "addon"),
      metadata: { addonKey: "whiteLabel", addonName: "White label", orgId: "org-a", quantity: "1" } });
    expect(r.status).toBe(202);
    expect(r.body.plan).toBeUndefined();
    expect(persistOrgData).not.toHaveBeenCalled();
    ctx = { ...ctx, addons: { whiteLabel: true } };
    const done = await call({ ...paid, mode: "subscription", subscription: sub("sub_addon", "addon"),
      metadata: { addonKey: "whiteLabel", orgId: "org-a", quantity: "1" } });
    expect(done.status).toBe(200);
    expect(done.body.checkoutType).toBe("addon_only");
    expect(done.body.plan).toBeUndefined();
    expect(persistOrgData).not.toHaveBeenCalled();
    expect(broadcastPlanUpdate).not.toHaveBeenCalled();
  });

  it("panier add-on seul (flowpoint_checkout_type=addon_only, selected_plan vide) : aucun plan écrit", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_addon", "addon"),
      metadata: { flowpoint_checkout_type: "addon_only", selected_plan: "", immediate_addons: "whiteLabel" } });
    expect(r.status).toBe(202);
    ctx = { ...ctx, addons: { whiteLabel: true } };
    const done = await call({ ...paid, mode: "subscription", subscription: sub("sub_addon", "addon"),
      metadata: { flowpoint_checkout_type: "addon_only", selected_plan: "", immediate_addons: "whiteLabel" } });
    expect(done.status).toBe(200);
    expect(done.body.checkoutType).toBe("addon_only");
    expect(r.body.checkoutType).toBe("addon_only");
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("crédits IA seuls : aucune écriture", async () => {
    const r = await call({ ...paid, mode: "payment", subscription: null,
      metadata: { type: "ai_credits", pack: "aiCreditsPack50k", credits: "50000", orgId: "org-a" } });
    expect(r.status).toBe(202);
    ledgerCredits = 50000;
    const done = await call({ ...paid, mode: "payment", subscription: null,
      metadata: { type: "ai_credits", pack: "aiCreditsPack50k", credits: "50000", orgId: "org-a" } });
    expect(done.status).toBe(200);
    expect(done.body.plan).toBeUndefined();
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("pack de crédits via addon-checkout (mode payment, sans type) : aucune écriture", async () => {
    const r = await call({ ...paid, mode: "payment", subscription: null,
      metadata: { addonKey: "aiCreditsPack50k", orgId: "org-a", quantity: "1" } });
    expect(r.status).toBe(202);
    ledgerCredits = 50000;
    const done = await call({ ...paid, mode: "payment", subscription: null,
      metadata: { addonKey: "aiCreditsPack50k", orgId: "org-a", quantity: "1" } });
    expect(done.status).toBe(200);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("mode payment sans abonnement ni metadata de type : aucune écriture", async () => {
    const r = await call({ ...paid, mode: "payment", subscription: null, metadata: { orgId: "org-a" } });
    expect(r.status).toBe(422);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("session sans metadata (client de l'org) et sans abonnement : aucune écriture", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: null, metadata: {} });
    expect(r.status).toBe(422);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("amount_total 0, paiement non requis, add-on seul : aucune écriture", async () => {
    const r = await call({ ...paid, payment_status: "no_payment_required", amount_total: 0, mode: "subscription",
      subscription: sub("sub_addon", "addon"), metadata: { flowpoint_checkout_type: "addon_only", immediate_addons: "whiteLabel" } });
    expect(r.status).toBe(202);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("metadata.plan=pro posé sur un add-on : aucun plan écrit", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_addon", "addon"),
      metadata: { addonKey: "whiteLabel", plan: "pro", orgId: "org-a" } });
    expect(r.status).toBe(202);
    ctx = { ...ctx, addons: { whiteLabel: true } };
    const done = await call({ ...paid, mode: "subscription", subscription: sub("sub_addon", "addon"),
      metadata: { addonKey: "whiteLabel", plan: "pro", orgId: "org-a" } });
    expect(done.status).toBe(200);
    expect(done.body.plan).toBeUndefined();
    expect(broadcastPlanUpdate).not.toHaveBeenCalled();
    expect(planWrites()).toHaveLength(0);
  });

  it("plan inconnu dans la metadata, abonnement sans prix de plan : aucune écriture", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_main", "addon"),
      metadata: { plan: "enterprise", orgId: "org-a" } });
    expect(r.status).toBe(422);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("session d'une autre organisation : 403 sans écriture", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_main", "pro"),
      metadata: { plan: "pro", orgId: "org-a" } }, "org-b");
    expect(r.status).toBe(403);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("ancienne session d'un autre abonnement alors qu'un abonnement est actif : aucune écriture", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_old", "pro"),
      metadata: { plan: "pro", orgId: "org-a" } });
    expect(r.status).toBe(409);
    expect(persistOrgData).not.toHaveBeenCalled();
  });

  it("plan pris sur le prix de l'abonnement, pas sur une metadata divergente", async () => {
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_main", "standard"),
      metadata: { plan: "ultra", orgId: "org-a" } });
    expect(r.status).toBe(200);
    expect(r.body.plan).toBe("standard");
  });

  it("session de plan légitime (première souscription) : plan et souscription écrits", async () => {
    ctx = { stripeCustomerId: "cus_a", stripeSubscriptionId: null, subscriptionStatus: null, plan: "standard", addons: {} };
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_new", "pro", "trialing"),
      metadata: { plan: "pro", orgId: "org-a" } });
    expect(r.status).toBe(200);
    expect(r.body.plan).toBe("pro");
    expect(persistOrgData).toHaveBeenCalledWith("org-a", expect.objectContaining({
      plan: "pro", stripeSubscriptionId: "sub_new", subscriptionStatus: "trialing" }));
  });

  it("réactivation : nouvel abonnement alors que l'ancien est annulé : écrit", async () => {
    ctx = { stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled", plan: "standard", addons: {} };
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_new", "ultra"),
      metadata: { plan: "ultra", orgId: "org-a", reactivation: "true" } });
    expect(r.status).toBe(200);
    expect(persistOrgData).toHaveBeenCalledWith("org-a", expect.objectContaining({ plan: "ultra", stripeSubscriptionId: "sub_new" }));
  });
  it("panier plan Standard + add-on (première souscription) : plan écrit", async () => {
    ctx = { stripeCustomerId: "cus_a", stripeSubscriptionId: null, subscriptionStatus: null, plan: "standard", addons: { whiteLabel: true } };
    const r = await call({ ...paid, mode: "subscription", subscription: sub("sub_cart", "standard", "trialing"),
      metadata: { flowpoint_checkout_type: "subscription_with_immediate_addons", selected_plan: "standard", immediate_addons: "whiteLabel" } });
    expect(r.status).toBe(200);
    expect(persistOrgData).toHaveBeenCalledWith("org-a", expect.objectContaining({ plan: "standard", stripeSubscriptionId: "sub_cart" }));
  });

  it("rejeu de la session de l'abonnement courant : plan relu sur le prix actuel", async () => {
    const r1 = await call({ ...paid, mode: "subscription", subscription: sub("sub_main", "pro"), metadata: { plan: "ultra", orgId: "org-a" } });
    const r2 = await call({ ...paid, mode: "subscription", subscription: sub("sub_main", "pro"), metadata: { plan: "ultra", orgId: "org-a" } });
    expect([r1.body.plan, r2.body.plan]).toEqual(["pro", "pro"]);
  });
});
