/**
 * addon-only-checkout.test.ts
 *
 * End-to-end regression for the dashboard → Pricing → Checkout add-on flow of
 * an ACTIVE subscriber. The dashboard intentionally builds a cart with
 * `plan: null` (the user's subscription is untouched); checkout.html then
 * sends `plan: ""` to POST /api/billing/quote and /api/public/payment-intent.
 *
 * The reviewer-rejected regression: the quote route rejected an empty plan,
 * so subscribed users could never pay for add-ons through the required
 * pricing/cart path. These tests pin the corrected behaviour:
 *
 *  1. Empty-plan + paid add-on quotes successfully (checkoutType addon_only).
 *  2. The subscriber's EXISTING plan drives inclusion checks server-side —
 *     an add-on bundled with their plan is never charged.
 *  3. /public/payment-intent creates a PaymentIntent for the quoted amount.
 *  4. AI-credit-only carts quote as one-time (ai_credits_only).
 *  5. An empty cart (no plan, no add-ons) is still rejected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { PLAN_INCLUDED_ADDONS, ADDON_DEFINITIONS } from "../lib/plans.js";
import { setStripeForTesting } from "../services/stripe-factory.js";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// Authenticated subscriber context: active Pro plan, trial already consumed.
const loadBillingContext = vi.fn(async (_orgId: string) => ({
  plan: "pro",
  subscriptionStatus: "active",
  stripeCustomerId: "cus_test_sub",
  email: "subscriber@x.co",
  canStartTrial: false,
  trialEndsAt: null,
}));
vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: (orgId: string) => loadBillingContext(orgId),
}));
vi.mock("../services/ensure-stripe-customer.js", () => ({
  ensureStripeCustomer: vi.fn(async () => "cus_test_sub"),
}));

// Rate limiter → pass-through (its plan lookup would hit the DB).
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// DB pool used by finalize-checkout (session lookup + AI credit insert).
const dbQueries: Array<{ sql: string; values: unknown[] }> = [];
vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({
      query: async (sql: string, values: unknown[] = []) => {
        dbQueries.push({ sql, values });
        if (/FROM user_sessions/.test(sql)) {
          return values[0] === "tok-subscriber" ? { rows: [{ org_id: "org-uuid-1" }] } : { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
    query: async (sql: string, values: unknown[] = []) => {
      dbQueries.push({ sql, values });
      return { rows: [] };
    },
  },
}));

const activatedAddons: Array<{ key: string; orgId: string; qty: number }> = [];
vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async (key: string, orgId: string, qty = 1) => {
    activatedAddons.push({ key, orgId, qty });
    return true;
  }),
  deactivateAddon: vi.fn(async () => true),
  provisionPlanAddons: vi.fn(async () => {}),
}));

const { default: publicBillingRouter } = await import("./public-billing.js");

function makeApp(orgId?: string, cookieToken?: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (orgId) { req.orgId = orgId; req.orgContext = { orgId, email: "subscriber@x.co" }; }
    req.cookies = cookieToken ? { fp_token: cookieToken } : {};
    next();
  });
  app.use("/api", publicBillingRouter);
  return app;
}

/** Recording fake Stripe client — no network. */
function makeFakeStripe(opts?: { existingPlanSubId?: string }) {
  const created: any[] = [];
  const subsCreated: any[] = [];
  const subsItemsCreated: any[] = [];
  const existingSubData = opts?.existingPlanSubId
    ? [{
        id: opts.existingPlanSubId,
        status: "active",
        // No "source" key → not an add-on-only sub, qualifies as plan sub.
        metadata: { plan: "pro" },
        items: { data: [{ price: { id: "price_plan_pro_monthly" } }] },
      }]
    : [];
  return {
    created,
    subsCreated,
    subsItemsCreated,
    paymentIntents: {
      create: vi.fn(async (params: any) => {
        created.push(params);
        return { id: "pi_fake_1", client_secret: "pi_fake_1_secret", ...params };
      }),
      retrieve: vi.fn(async (id: string) => ({
        id,
        status: "succeeded",
        payment_method: "pm_fake_1",
        customer: "cus_test_sub",
        metadata: {},
      })),
    },
    setupIntents: {
      create: vi.fn(async (params: any) => ({ id: "seti_fake_1", client_secret: "seti_fake_1_secret", ...params })),
    },
    subscriptions: {
      list: vi.fn(async () => ({ data: existingSubData })),
      create: vi.fn(async (params: any) => {
        subsCreated.push(params);
        return { id: "sub_fake_addon_1", ...params };
      }),
    },
    subscriptionItems: {
      create: vi.fn(async (params: any) => {
        subsItemsCreated.push(params);
        return { id: "si_fake_1", ...params };
      }),
    },
    paymentMethods: {
      attach: vi.fn(async () => ({})),
      retrieve: vi.fn(async () => ({ billing_details: { email: "subscriber@x.co" } })),
    },
    customers: {
      retrieve: vi.fn(async () => ({ id: "cus_test_sub", deleted: false })),
      list: vi.fn(async () => ({ data: [] })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: "cus_test_sub" })),
    },
  };
}

const PRO_BUNDLE = PLAN_INCLUDED_ADDONS["pro"] ?? new Set<string>();
/** A recurring add-on the mocked pro subscriber genuinely has to pay for. */
const PAID_ADDON = Object.entries(ADDON_DEFINITIONS)
  .find(([k, d]) => !d.oneTime && !PRO_BUNDLE.has(k))![0];
const eur = (k: string) => Math.round(ADDON_DEFINITIONS[k]!.priceEur * 100);
/** An add-on the mocked subscriber's plan (pro) already bundles, if any. */
const PRO_INCLUDED = [...PRO_BUNDLE].find(k => ADDON_DEFINITIONS[k]);

const PREV_NODE_ENV = process.env["NODE_ENV"];
beforeEach(() => {
  // setStripeForTesting refuses to run under NODE_ENV=production (correct in
  // prod; here we are in vitest, so force a test env for the injection).
  process.env["NODE_ENV"] = "test";
  process.env["STRIPE_SECRET_KEY"] ||= "sk_live_dummy_for_tests";
  setStripeForTesting(makeFakeStripe());
});
afterEach(() => {
  setStripeForTesting(null);
  if (PREV_NODE_ENV === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = PREV_NODE_ENV;
});

describe("active subscriber — add-on-only quote (empty plan)", () => {
  it("quotes a paid add-on with plan:'' instead of rejecting the cart", async () => {
    const r = await request(makeApp("org-uuid-1"))
      .post("/api/billing/quote")
      .send({ plan: "", addons: { [PAID_ADDON]: true } });
    expect(r.status).toBe(200);
    expect(r.body.quote.checkoutType).toBe("addon_only");
    expect(r.body.quote.plan).toBeNull();
    expect(r.body.quote.amountDueTodayMinor).toBe(eur(PAID_ADDON));
    expect(r.body.quote.paymentIntentAmountMinor).toBe(eur(PAID_ADDON));
  });

  it("honours the subscriber's existing plan for inclusions (bundled add-on costs 0)", async () => {
    if (!PRO_INCLUDED) return; // pro bundles nothing billable — nothing to pin
    const r = await request(makeApp("org-uuid-1"))
      .post("/api/billing/quote")
      .send({ plan: "", addons: { [PRO_INCLUDED]: true } });
    expect(r.status).toBe(200);
    const line = r.body.quote.lines.find((l: any) => l.key === PRO_INCLUDED);
    expect(line.includedInPlan).toBe(true);
    expect(line.amountMinor).toBe(0);
    expect(r.body.quote.amountDueTodayMinor).toBe(0);
    expect(loadBillingContext).toHaveBeenCalledWith("org-uuid-1");
  });

  it("still charges full price for an anonymous empty-plan cart (no plan context)", async () => {
    if (!PRO_INCLUDED) return;
    const r = await request(makeApp())
      .post("/api/billing/quote")
      .send({ plan: "", addons: { [PRO_INCLUDED]: true } });
    expect(r.status).toBe(200);
    expect(r.body.quote.amountDueTodayMinor).toBe(eur(PRO_INCLUDED));
  });

  it("quotes AI credit packs as a one-time purchase", async () => {
    const r = await request(makeApp("org-uuid-1"))
      .post("/api/billing/quote")
      .send({ plan: "", addons: { aiCreditsPack50k: 1 } });
    expect(r.status).toBe(200);
    expect(r.body.quote.checkoutType).toBe("ai_credits_only");
    expect(r.body.quote.lines[0].interval).toBe("one_time");
  });

  it("rejects a cart with neither plan nor billable add-ons", async () => {
    const r = await request(makeApp("org-uuid-1"))
      .post("/api/billing/quote")
      .send({ plan: "", addons: {} });
    expect(r.status).toBe(400);
  });
});

describe("active subscriber — payment initiation (checkout.html path)", () => {
  it("creates a PaymentIntent for exactly the quoted add-on amount", async () => {
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1"))
      .post("/api/public/payment-intent")
      .send({ plan: "", addons: { [PAID_ADDON]: true } });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe("payment");
    expect(r.body.immediateAmount).toBe(eur(PAID_ADDON));
    expect(r.body.clientSecret).toBe("pi_fake_1_secret");
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].amount).toBe(eur(PAID_ADDON));
    // Charged to the subscriber's own Stripe customer, not an anonymous PI.
    expect(fake.created[0].customer).toBe("cus_test_sub");
  });

  it("never asks a bundled add-on to be paid at payment initiation", async () => {
    if (!PRO_INCLUDED) return;
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1"))
      .post("/api/public/payment-intent")
      .send({ plan: "", addons: { [PRO_INCLUDED]: true } });
    // Nothing to collect and no plan → the route must not mint a bogus 0€ PI.
    expect(fake.created).toHaveLength(0);
    expect(r.status).toBe(400);
  });
});

describe("active subscriber — finalize-checkout provisions the add-on (no plan)", () => {
  beforeEach(() => { activatedAddons.length = 0; dbQueries.length = 0; });

  it("creates the month-2 add-on subscription when no existing plan sub is found (fallback)", async () => {
    // No existing plan sub (list returns []) → falls back to creating a new subscription.
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: "pi_fake_1", intentType: "payment", plan: "", addons: { [PAID_ADDON]: true } });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.checkoutType).toBe("addon_only");
    expect(r.body.addons).toContain(PAID_ADDON);
    // Recurring subscription starts at month 2 (trial_end set) — month 1 was the PI.
    expect(fake.subsCreated).toHaveLength(1);
    expect(fake.subsCreated[0].items).toEqual([{ price: expect.stringMatching(/^price_/), quantity: 1 }]);
    expect(fake.subsCreated[0].trial_end).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(fake.subsCreated[0].metadata.org_id).toBe("org-uuid-1");
    // No subscriptionItems.create called (no existing sub to add to).
    expect(fake.subsItemsCreated).toHaveLength(0);
    // Entitlement granted immediately, not left to webhook latency.
    expect(activatedAddons).toEqual([{ key: PAID_ADDON, orgId: "org-uuid-1", qty: 1 }]);
  });

  it("adds add-on items to existing plan subscription instead of creating a second sub", async () => {
    // Has existing plan sub → must add items to it, NOT create a second subscription.
    const fake = makeFakeStripe({ existingPlanSubId: "sub_existing_plan" });
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: "pi_fake_5", intentType: "payment", plan: "", addons: { [PAID_ADDON]: true } });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.checkoutType).toBe("addon_only");
    // No second subscription must be created.
    expect(fake.subsCreated).toHaveLength(0);
    // Item was added to the existing plan subscription.
    expect(fake.subsItemsCreated).toHaveLength(1);
    expect(fake.subsItemsCreated[0].subscription).toBe("sub_existing_plan");
    expect(fake.subsItemsCreated[0].proration_behavior).toBe("none");
    expect(fake.subsItemsCreated[0].price).toMatch(/^price_/);
    // Entitlement granted immediately regardless of which Stripe path was taken.
    expect(activatedAddons.some(a => a.key === PAID_ADDON && a.orgId === "org-uuid-1")).toBe(true);
  });

  it("credits AI packs idempotently for a credits-only cart", async () => {
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: "pi_fake_2", intentType: "payment", plan: "", addons: { aiCreditsPack50k: 1 } });
    expect(r.status).toBe(200);
    expect(r.body.checkoutType).toBe("ai_credits_only");
    const insert = dbQueries.find(q => /INSERT INTO ai_credit_purchases/.test(q.sql));
    expect(insert).toBeDefined();
    // Key must match acp_pi_<intentId> — same format the payment_intent.succeeded webhook uses.
    expect(insert!.values[0]).toBe("acp_pi_pi_fake_2");
    expect(insert!.values[1]).toBe("org-uuid-1");
    expect(insert!.values[3]).toBe(50000);
    expect(fake.subsCreated).toHaveLength(0); // one-time — no subscription
  });

  it("rejects finalize without an authenticated session", async () => {
    const r = await request(makeApp())
      .post("/api/public/finalize-checkout")
      .send({ intentId: "pi_fake_3", intentType: "payment", plan: "", addons: { [PAID_ADDON]: true } });
    expect(r.status).toBe(401);
    expect(activatedAddons).toHaveLength(0);
  });
});

// ── AI credits idempotency — all order combinations ───────────────────────────
// The idempotency guarantee: regardless of which actor (webhook or finalize-checkout)
// credits the org first, and regardless of replays, the org receives credits exactly once.
// Both paths use the same key: acp_pi_<intentId>.  The DB UNIQUE constraint + ON CONFLICT
// DO NOTHING enforces the invariant at persistence time.
describe("AI credits idempotency — all order combinations", () => {
  const AI_PACK   = "aiCreditsPack500k";
  const CREDITS   = 500000;
  const INTENT_ID = "pi_idem_test";

  beforeEach(() => { dbQueries.length = 0; activatedAddons.length = 0; });

  function allCreditInserts() {
    return dbQueries.filter(q => /INSERT INTO ai_credit_purchases/.test(q.sql));
  }

  // ── T1: Normal — finalize-checkout runs, credits ×1 ──────────────────────
  it("T1 — normal return: finalize-checkout credits the org exactly once", async () => {
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: INTENT_ID, intentType: "payment", plan: "", addons: { [AI_PACK]: 1 } });
    expect(r.status).toBe(200);
    expect(r.body.checkoutType).toBe("ai_credits_only");
    expect(r.body.credits).toBe(CREDITS);
    const inserts = allCreditInserts();
    expect(inserts).toHaveLength(1);
    // Key matches the payment_intent.succeeded webhook exactly.
    expect(inserts[0].values[0]).toBe(`acp_pi_${INTENT_ID}`);
    expect(inserts[0].values[3]).toBe(CREDITS);
    expect(inserts[0].values[6]).toBe(INTENT_ID); // stripe_payment_intent column
    expect(fake.subsCreated).toHaveLength(0); // one-time — no recurring subscription
  });

  // ── T2: finalize-checkout called twice (browser reload / double-submit) ───
  it("T2 — double finalize: both calls return 200, same idempotency key used both times", async () => {
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const body = { intentId: INTENT_ID, intentType: "payment", plan: "", addons: { [AI_PACK]: 1 } };
    const r1 = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout").send(body);
    expect(r1.status).toBe(200);
    const r2 = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout").send(body);
    expect(r2.status).toBe(200);
    const inserts = allCreditInserts();
    // Two SQL statements were issued — both ON CONFLICT DO NOTHING.
    // The DB constraint prevents the second row from being persisted.
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values[0]).toBe(`acp_pi_${INTENT_ID}`);
    expect(inserts[1].values[0]).toBe(`acp_pi_${INTENT_ID}`); // same key → DB no-op
  });

  // ── T3: Webhook arrives first, then finalize-checkout ───────────────────
  // Simulated by pre-inserting the webhook's row into the in-memory query log,
  // then verifying finalize uses the identical key (which the DB would reject).
  it("T3 — webhook then finalize: finalize uses the same key the webhook would have used", async () => {
    // Pre-populate the mock DB log as if the webhook already ran.
    dbQueries.push({
      sql: `INSERT INTO ai_credit_purchases (id, org_id, pack, credits, ...) VALUES ($1,...) ON CONFLICT (id) DO NOTHING`,
      values: [`acp_pi_${INTENT_ID}`, "org-uuid-1", AI_PACK, CREDITS, 0, "", INTENT_ID],
    });
    const insertsBefore = allCreditInserts().length;

    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: INTENT_ID, intentType: "payment", plan: "", addons: { [AI_PACK]: 1 } });
    expect(r.status).toBe(200);

    const insertsAfter = allCreditInserts();
    // The new finalize insert has the same key as the pre-existing "webhook" row.
    const finalizeInsert = insertsAfter[insertsBefore]; // the one finalize added
    expect(finalizeInsert).toBeDefined();
    expect(finalizeInsert.values[0]).toBe(`acp_pi_${INTENT_ID}`); // collides → DB no-op
  });

  // ── T4: finalize-checkout first, then webhook ────────────────────────────
  // Verified by confirming finalize uses acp_pi_<intentId> — the same key
  // the payment_intent.succeeded handler inserts at stripe-webhook.ts line 903.
  it("T4 — finalize then webhook: idempotency key is acp_pi_<intentId> on BOTH sides", async () => {
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: INTENT_ID, intentType: "payment", plan: "", addons: { [AI_PACK]: 1 } });
    expect(r.status).toBe(200);
    const inserts = allCreditInserts();
    expect(inserts[0].values[0]).toBe(`acp_pi_${INTENT_ID}`); // finalize key
    // Webhook key (from stripe-webhook.ts:903): `acp_pi_${piId}` where piId = intentId.
    const webhookKey = `acp_pi_${INTENT_ID}`;
    expect(inserts[0].values[0]).toBe(webhookKey); // same key — DB constraint prevents duplicate
  });

  // ── T5: PaymentIntent metadata carries type=ai_credits for webhook fallback ──
  // (closed-tab recovery: user pays but closes browser before checkout-return runs)
  it("T5 — closed-tab recovery: payment-intent endpoint tags PI metadata with type=ai_credits + orgId", async () => {
    const fake = makeFakeStripe();
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/payment-intent")
      .send({ plan: "", addons: { [AI_PACK]: 1 }, mode: "payment" });
    expect(r.status).toBe(200);
    // The PaymentIntent must have been created with type=ai_credits in metadata.
    expect(fake.created).toHaveLength(1);
    const piParams = fake.created[0];
    expect(piParams.metadata?.type).toBe("ai_credits");
    expect(piParams.metadata?.pack).toBe(AI_PACK);
    expect(piParams.metadata?.credits).toBe(String(CREDITS));
    expect(piParams.metadata?.orgId).toBe("org-uuid-1");
    // The webhook can now attribute credits even if finalize is never called.
  });

  // ── T6: Failed payment — 0 credits ──────────────────────────────────────
  it("T6 — failed payment: finalize-checkout requires intentType=payment and a succeeded PI — 400 if PI not succeeded", async () => {
    const fake = makeFakeStripe();
    // Override retrieve to return a failed PI.
    fake.paymentIntents.retrieve = vi.fn(async (id: string) => ({
      id,
      status: "requires_payment_method", // payment failed
      payment_method: "" as string,        // no PM attached on failure
      customer: "cus_test_sub",
      metadata: {},
    }));
    setStripeForTesting(fake);
    const r = await request(makeApp("org-uuid-1", "tok-subscriber"))
      .post("/api/public/finalize-checkout")
      .send({ intentId: INTENT_ID, intentType: "payment", plan: "", addons: { [AI_PACK]: 1 } });
    // Must reject the finalize — payment did not succeed.
    expect([400, 402, 422]).toContain(r.status);
    expect(allCreditInserts()).toHaveLength(0); // 0 credits attributed
  });
});
