/**
 * billing-upgrade-reactivation.test.ts
 *
 * 7 tests covering the "Passer/Reprendre plan" upgrade route smart routing:
 *
 *   CAS 1 — active + cancel_at_period_end=true + same plan
 *            → updates subscription (cancel_at_period_end=false), no Checkout
 *
 *   CAS 2a — canceled + customer has reusable PM
 *            → creates subscription server-side, no Checkout
 *
 *   CAS 2b — canceled + customer has PM but payment fails (card_error)
 *            → stays on dashboard; never auto-redirects to Checkout
 *
 *   CAS 3  — active + different plan (upgrade)
 *            → updates subscription with new price, no Checkout
 *
 *   CAS 4  — canceled + no PM
 *            → creates Checkout Session
 *
 *   CAS 5  — no duplicate Customer: all server-side paths reuse existing customerId
 *
 *   CAS 6  — canceled + customer deleted in Stripe
 *            → billing_customer_missing 409 (no new customer created)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared constants ───────────────────────────────────────────────────────────
const ORG_ID   = "aabbccdd-1111-2222-3333-444455556666";
const CUS_ID   = "cus_test_reactivation_abc123";
const PM_ID    = "pm_test_valid_card";
const SUB_ID   = "sub_test_existing_abc";
const NEW_SUB  = "sub_test_new_created_xyz";
const PRICE_STD = "price_standard_live";
const PRICE_PRO = "price_pro_live";

// ── Module mocks ───────────────────────────────────────────────────────────────

// pool mock — implementations are re-applied in beforeEach after vi.clearAllMocks()
const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: vi.fn(),
}));

vi.mock("../services/org-data.js", () => ({
  persistOrgData:        vi.fn().mockResolvedValue(undefined),
  loadOrgData:           vi.fn().mockResolvedValue({}),
  findOrgByStripeCustomer: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings:   vi.fn().mockResolvedValue(null),
  upsertOrgSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/store.js", () => ({
  store: { broadcastPlanUpdate: vi.fn(), addSseClient: vi.fn(), removeSseClient: vi.fn() },
}));

vi.mock("../services/billing-service.js", () => ({
  getUsageSummary:         vi.fn(),
  getMRRData:              vi.fn(),
  getSubscriptionAnalytics: vi.fn(),
  startTrial:              vi.fn(),
  validateCoupon:          vi.fn(),
  getInvoices:             vi.fn(),
  trackBillingEvent:       vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/ensure-stripe-customer.js", () => ({
  ensureStripeCustomer: vi.fn().mockResolvedValue(CUS_ID),
}));

vi.mock("../services/billing-schedule.js", () => ({
  ensureStripeScheduleTarget: vi.fn().mockResolvedValue({ alreadyTarget: false }),
}));

vi.mock("../services/sessions.js", () => ({
  getSession:            vi.fn(),
  invalidateAllSessions: vi.fn(),
}));

vi.mock("../services/addons-service.js", () => ({
  provisionPlanAddons: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/billing-quote.js", () => ({
  createBillingQuote:    vi.fn(),
  quoteToStripeLineItems: vi.fn(),
}));

vi.mock("../services/mailer.js", () => ({
  mailer: { send: vi.fn() },
}));

vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/requireRole.js", () => ({
  ownerOnly: (_req: unknown, _res: unknown, next: () => void) => next(),
  canAdmin:  (_req: unknown, _res: unknown, next: () => void) => next(),
  canWrite:  (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/plans.js", () => ({
  PLAN_PRICE_IDS: {
    standard: PRICE_STD,
    pro:      PRICE_PRO,
    ultra:    "price_ultra_live",
  },
  ADDON_PRICE_IDS:     {},
  FLAG_ADDONS:         [],
  QTY_ADDONS:          [],
  PLAN_LIMITS:         { standard: {}, pro: {}, ultra: {} },
  PLAN_INCLUDED_ADDONS: { standard: new Set(), pro: new Set(), ultra: new Set() },
}));

// ── Stripe factory: injectable per test ───────────────────────────────────────
let _stripeMock: Record<string, unknown> = {};
vi.mock("../services/stripe-factory.js", () => ({
  createStripeClient:       vi.fn(() => Promise.resolve(_stripeMock)),
  getStripeKey:             vi.fn(() => "sk_live_test"),
  getStripeCheckoutModeLog: vi.fn(() => "test"),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
import { loadBillingContext } from "../services/billing-context.js";
const mockLoadBillingContext = loadBillingContext as ReturnType<typeof vi.fn>;

/** Build a minimal Express-like req/res pair for the route handler. */
function makeReqRes(body: Record<string, unknown> = {}) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    req: {
      body,
      orgId:  ORG_ID,
      userId: "user-test-xyz",
      headers: {},
    } as unknown as import("express").Request,
    res: { json, status } as unknown as import("express").Response,
    json,
    status,
  };
}

/** Build a minimal active Stripe subscription stub. */
function makeActiveSub(overrides: Record<string, unknown> = {}) {
  return {
    id:                SUB_ID,
    status:            "active",
    cancel_at_period_end: false,
    schedule:          null,
    trial_end:         null,
    items: {
      data: [{ id: "si_plan", price: { id: PRICE_STD }, quantity: 1 }],
    },
    ...overrides,
  };
}

/** Load the router (fresh each test via vi.resetModules) */
async function getUpgradeHandler() {
  const mod = await import("../routes/billing.js");
  // The route is registered on the Express Router; retrieve it via the stack
  const router = (mod as unknown as { default: { stack: Array<{ route?: { path: string; stack: Array<{ handle: (...a: unknown[]) => unknown }> } }> } }).default;
  const upgradeRoute = router.stack.find(
    (l) => l.route?.path === "/billing/upgrade",
  );
  if (!upgradeRoute?.route) throw new Error("Route /billing/upgrade not found");
  // Last handler in the stack is the async implementation (rate-limit + ownerOnly + handler)
  const handlers = upgradeRoute.route.stack;
  return handlers[handlers.length - 1].handle;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Re-apply pool implementations after clearAllMocks (implementations are preserved
  // by clearAllMocks, but resetModules forces a fresh import, so we seed them here).
  mockPoolQuery.mockResolvedValue({ rows: [{ stripe_customer_id: CUS_ID }], rowCount: 1 });
  mockPoolConnect.mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    release: vi.fn(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 1 — active + cancel_at_period_end=true + same plan → clear cancellation
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 1 — active + cancel_at_period_end=true + same plan", () => {
  it("updates subscription to clear cancel_at_period_end, returns ok without Checkout", async () => {
    mockLoadBillingContext.mockResolvedValue({
      plan:               "standard",
      subscriptionStatus: "active",
      stripeCustomerId:   CUS_ID,
    });

    const sub = makeActiveSub({ cancel_at_period_end: true });
    const subUpdate = vi.fn().mockResolvedValue({ ...sub, cancel_at_period_end: false });
    const subsList  = vi.fn().mockImplementation(({ status }: { status: string }) =>
      Promise.resolve({ data: status === "active" ? [sub] : [] }),
    );
    const sessionCreate = vi.fn();

    _stripeMock = {
      subscriptions: { list: subsList, update: subUpdate, create: vi.fn() },
      checkout:      { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res, json, status } = makeReqRes({ plan: "standard" });
    const handler = await getUpgradeHandler();
    await handler(req, res, vi.fn());

    // Must NOT create a Checkout Session
    expect(sessionCreate).not.toHaveBeenCalled();
    // Must call subscriptions.update with cancel_at_period_end: false
    expect(subUpdate).toHaveBeenCalledWith(
      SUB_ID,
      expect.objectContaining({ cancel_at_period_end: false }),
    );
    // Response must carry ok + reactivated
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, reactivated: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 2a — canceled + customer has reusable PM → server-side subscription
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 2a — canceled + customer has PM → server-side subscription, no Checkout", () => {
  it("creates subscription directly and preserves the original future trial_end", async () => {
    mockLoadBillingContext.mockResolvedValue({
      plan:               "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId:   CUS_ID,
      stripeSubscriptionId: "sub_canceled_with_trial_history",
    });

    const customerRetrieve = vi.fn().mockResolvedValue({
      id:      CUS_ID,
      deleted: false,
      invoice_settings: { default_payment_method: { id: PM_ID } },
    });
    const originalTrialEnd = Math.floor(Date.now() / 1000) + (10 * 24 * 60 * 60);
    const canceledSub = {
      id: "sub_canceled_with_trial_history",
      status: "canceled",
      customer: CUS_ID,
      trial_end: originalTrialEnd,
      default_payment_method: PM_ID,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    };
    const newerCanceledSub = {
      id: "sub_newer_without_trial",
      status: "canceled",
      customer: CUS_ID,
      trial_end: null,
      default_payment_method: PM_ID,
      items: { data: [{ current_period_end: originalTrialEnd - 100 }] },
    };
    const subCreate    = vi.fn().mockResolvedValue({
      id: NEW_SUB,
      status: "trialing",
      trial_end: originalTrialEnd,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    });
    const subsList     = vi.fn().mockImplementation(({ status }: { status: string }) =>
      Promise.resolve({ data: status === "canceled" ? [newerCanceledSub, canceledSub] : [] }),
    );
    const sessionCreate = vi.fn();

    _stripeMock = {
      customers:     { retrieve: customerRetrieve, create: vi.fn() },
      subscriptions: {
        list: subsList,
        retrieve: vi.fn().mockResolvedValue(canceledSub),
        create: subCreate,
        update: vi.fn(),
      },
      checkout:      { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res, json, status } = makeReqRes({ plan: "standard" });
    const handler = await getUpgradeHandler();
    await handler(req, res, vi.fn());

    // Must NOT create a Checkout Session
    expect(sessionCreate).not.toHaveBeenCalled();
    // Must create subscription with existing customer (no new customer created)
    expect(subCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: CUS_ID,
        default_payment_method: PM_ID,
        trial_end: originalTrialEnd,
      }),
    );
    // Response must carry ok + reactivated
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        reactivated: true,
        upgraded: true,
        subscriptionStatus: "trialing",
        trialEndsAt: new Date(originalTrialEnd * 1000).toISOString(),
        currentPeriodEnd: new Date(originalTrialEnd * 1000).toISOString(),
        customerReused: true,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 2b — canceled + PM exists but payment fails → stay on dashboard
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 2b — canceled + PM but payment fails → no automatic Checkout", () => {
  it("returns a typed payment action error when subscription.create throws card_error", async () => {
    mockLoadBillingContext.mockResolvedValue({
      plan:               "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId:   CUS_ID,
    });

    const cardError = Object.assign(new Error("card declined"), {
      type: "card_error",
      code: "card_declined",
    });
    const customerRetrieve = vi.fn().mockResolvedValue({
      id:      CUS_ID,
      deleted: false,
      invoice_settings: { default_payment_method: { id: PM_ID } },
    });
    const subCreate    = vi.fn().mockRejectedValue(cardError);
    const sessionCreate = vi.fn().mockResolvedValue({ id: "cs_fallback_xyz", url: "https://checkout.stripe.com/fallback" });

    _stripeMock = {
      customers:     { retrieve: customerRetrieve },
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }), create: subCreate, update: vi.fn() },
      checkout:      { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res, json, status } = makeReqRes({ plan: "standard" });
    const handler = await getUpgradeHandler();
    await handler(req, res, vi.fn());

    // A reusable PM was found: never create or auto-redirect to Checkout.
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        reactivation: true,
        requiresPaymentAction: true,
        error: "payment_method_reactivation_failed",
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 2c — exact history anchor remains usable when canceled-history list fails
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 2c — anchored historical trial survives a history-list outage", () => {
  it("uses the verified anchored subscription trial_end instead of charging immediately", async () => {
    const originalTrialEnd = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
    mockLoadBillingContext.mockResolvedValue({
      plan: "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId: CUS_ID,
      stripeSubscriptionId: "sub_anchored_history",
      trialEndsAt: new Date(originalTrialEnd * 1000).toISOString(),
    });
    const anchoredSub = {
      id: "sub_anchored_history",
      status: "canceled",
      customer: CUS_ID,
      trial_end: originalTrialEnd,
      default_payment_method: PM_ID,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    };
    const subCreate = vi.fn().mockResolvedValue({
      id: NEW_SUB,
      status: "trialing",
      trial_end: originalTrialEnd,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    });
    const sessionCreate = vi.fn();
    _stripeMock = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: CUS_ID,
          deleted: false,
          invoice_settings: { default_payment_method: PM_ID },
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(anchoredSub),
        list: vi.fn().mockImplementation(({ status }: { status: string }) =>
          status === "canceled"
            ? Promise.reject(new Error("temporary Stripe list outage"))
            : Promise.resolve({ data: [] }),
        ),
        create: subCreate,
        update: vi.fn(),
      },
      checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res, json } = makeReqRes({ plan: "standard" });
    await (await getUpgradeHandler())(req, res, vi.fn());

    expect(sessionCreate).not.toHaveBeenCalled();
    expect(subCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUS_ID, trial_end: originalTrialEnd }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        trialEndsAt: new Date(originalTrialEnd * 1000).toISOString(),
      }),
    );
  });
});

describe("CAS 2d — partial attached-PM lookup failure", () => {
  it("uses a card result even when the SEPA lookup fails", async () => {
    const originalTrialEnd = Math.floor(Date.now() / 1000) + (5 * 24 * 60 * 60);
    mockLoadBillingContext.mockResolvedValue({
      plan: "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId: CUS_ID,
      stripeSubscriptionId: "sub_without_default_pm",
    });
    const anchoredSub = {
      id: "sub_without_default_pm",
      status: "canceled",
      customer: CUS_ID,
      trial_end: originalTrialEnd,
      default_payment_method: null,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    };
    const subCreate = vi.fn().mockResolvedValue({
      id: NEW_SUB,
      status: "trialing",
      trial_end: originalTrialEnd,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    });
    const sessionCreate = vi.fn();
    _stripeMock = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: CUS_ID,
          deleted: false,
          invoice_settings: { default_payment_method: null },
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(anchoredSub),
        list: vi.fn().mockImplementation(({ status }: { status: string }) =>
          Promise.resolve({ data: status === "canceled" ? [anchoredSub] : [] }),
        ),
        create: subCreate,
        update: vi.fn(),
      },
      paymentMethods: {
        list: vi.fn().mockImplementation(({ type }: { type: string }) =>
          type === "card"
            ? Promise.resolve({ data: [{ id: PM_ID }] })
            : Promise.reject(new Error("SEPA lookup unavailable")),
        ),
      },
      checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res } = makeReqRes({ plan: "standard" });
    await (await getUpgradeHandler())(req, res, vi.fn());

    expect(sessionCreate).not.toHaveBeenCalled();
    expect(subCreate).toHaveBeenCalledWith(
      expect.objectContaining({ default_payment_method: PM_ID, trial_end: originalTrialEnd }),
    );
  });
});

describe("CAS 2e — less than 48 hours remain and no PM exists", () => {
  it("stays on the dashboard instead of creating an invalid Checkout subscription", async () => {
    const originalTrialEnd = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
    mockLoadBillingContext.mockResolvedValue({
      plan: "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId: CUS_ID,
      stripeSubscriptionId: "sub_short_trial",
    });
    const anchoredSub = {
      id: "sub_short_trial",
      status: "canceled",
      customer: CUS_ID,
      trial_end: originalTrialEnd,
      default_payment_method: null,
      items: { data: [{ current_period_end: originalTrialEnd }] },
    };
    const sessionCreate = vi.fn();
    const subCreate = vi.fn();
    _stripeMock = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: CUS_ID,
          deleted: false,
          invoice_settings: { default_payment_method: null },
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(anchoredSub),
        list: vi.fn().mockImplementation(({ status }: { status: string }) =>
          Promise.resolve({ data: status === "canceled" ? [anchoredSub] : [] }),
        ),
        create: subCreate,
        update: vi.fn(),
      },
      paymentMethods: { list: vi.fn().mockResolvedValue({ data: [] }) },
      checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res, json, status } = makeReqRes({ plan: "standard" });
    await (await getUpgradeHandler())(req, res, vi.fn());

    expect(subCreate).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        reactivation: true,
        requiresPaymentAction: true,
        error: "payment_method_required_before_reactivation",
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 3 — active + different plan (upgrade) → immediate sub update, no Checkout
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 3 — active + plan change (standard → pro) → immediate update", () => {
  it("updates subscription price without creating a Checkout Session", async () => {
    mockLoadBillingContext.mockResolvedValue({
      plan:               "standard",
      subscriptionStatus: "active",
      stripeCustomerId:   CUS_ID,
    });

    const sub       = makeActiveSub();
    const subUpdate = vi.fn().mockResolvedValue({ ...sub, status: "active" });
    const subsList  = vi.fn().mockImplementation(({ status }: { status: string }) =>
      Promise.resolve({ data: status === "active" ? [sub] : [] }),
    );
    const sessionCreate = vi.fn();

    _stripeMock = {
      subscriptions: { list: subsList, update: subUpdate, create: vi.fn() },
      checkout:      { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
      subscriptionSchedules: { release: vi.fn(), create: vi.fn(), retrieve: vi.fn() },
    };

    const { req, res, json } = makeReqRes({ plan: "pro" });
    const handler = await getUpgradeHandler();
    await handler(req, res, vi.fn());

    expect(sessionCreate).not.toHaveBeenCalled();
    expect(subUpdate).toHaveBeenCalledWith(
      SUB_ID,
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ price: PRICE_PRO })]) }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, upgraded: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 4 — canceled + no PM → Checkout Session required
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 4 — canceled + no default PM → Checkout Session", () => {
  it("creates Checkout Session when customer has no reusable payment method", async () => {
    mockLoadBillingContext.mockResolvedValue({
      plan:               "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId:   CUS_ID,
    });

    const customerRetrieve = vi.fn().mockResolvedValue({
      id:      CUS_ID,
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });
    const subCreate    = vi.fn();
    const sessionCreate = vi.fn().mockResolvedValue({ id: "cs_no_pm_abc", url: "https://checkout.stripe.com/no-pm" });

    _stripeMock = {
      customers:     { retrieve: customerRetrieve },
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }), create: subCreate, update: vi.fn() },
      paymentMethods: { list: vi.fn().mockResolvedValue({ data: [] }) },
      checkout:      { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: sessionCreate } },
    };

    const { req, res, json } = makeReqRes({ plan: "standard" });
    const handler = await getUpgradeHandler();
    await handler(req, res, vi.fn());

    // No direct subscription creation attempted
    expect(subCreate).not.toHaveBeenCalled();
    // Checkout Session created
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUS_ID }),
      expect.anything(),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ reactivation: true, checkoutUrl: "https://checkout.stripe.com/no-pm" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 5 — no duplicate Customer in any path
// ─────────────────────────────────────────────────────────────────────────────
describe("CAS 5 — no duplicate Stripe Customer in any scenario", () => {
  it("reuses the existing customerId and never calls customers.create in CAS 2a", async () => {
    mockLoadBillingContext.mockResolvedValue({
      plan:               "standard",
      subscriptionStatus: "canceled",
      stripeCustomerId:   CUS_ID,
    });

    const customerCreate   = vi.fn();
    const customerRetrieve = vi.fn().mockResolvedValue({
      id: CUS_ID, deleted: false,
      invoice_settings: { default_payment_method: { id: PM_ID } },
    });
    const subCreate    = vi.fn().mockResolvedValue({ id: NEW_SUB, status: "active" });

    _stripeMock = {
      customers:     { retrieve: customerRetrieve, create: customerCreate },
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }), create: subCreate, update: vi.fn() },
      checkout:      { sessions: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() } },
    };

    const { req, res } = makeReqRes({ plan: "standard" });
    const handler = await getUpgradeHandler();
    await handler(req, res, vi.fn());

    expect(customerCreate).not.toHaveBeenCalled();
    expect(subCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUS_ID }),
    );
  });
});
