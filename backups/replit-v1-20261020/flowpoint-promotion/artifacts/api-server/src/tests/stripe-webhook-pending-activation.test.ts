/**
 * stripe-webhook-pending-activation.test.ts — P0 STRIPE_WEBHOOK_ORG_RACE
 *
 * Production incident (LIVE, 2026-09-08/09/12): for a new pre-registered signup,
 * finalize-checkout creates the Stripe subscription BEFORE it commits the
 * canonical UUID organization (FC-4). Stripe delivers
 * customer.subscription.created inside that window; the customer still resolves
 * to the pre-registration key (email, via org_settings.stripe_customer_id) and
 * `UPDATE organizations ... WHERE id = $1` fails with 22P02 / string_to_uuid.
 * The handler returned 500 and the org was only synced by Stripe's retry.
 *
 * These tests drive the REAL webhook router with a fake Postgres that enforces
 * the UUID type of organizations.id exactly like production (22P02), and
 * simulate finalize-checkout committing the organization shortly after the
 * webhook arrives.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const EMAIL    = "new.signup@example.com";
const ORG_UUID = "b89babd6-a867-496a-b45c-420841f95e09";
const CUS      = "cus_TESTRACE";
const SUB      = "sub_TESTRACE";
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Fake world state ─────────────────────────────────────────────────────────
let orgCreated: boolean;          // organizations row committed by finalize FC-4
let pendingSignup: boolean;       // pending_signups row (unconsumed) exists
let trialAlreadyConsumed: boolean;
let billingEvents: Map<string, { status: string; orgId: string }>;
let uuidQueries: Array<{ sql: string; id: unknown }>;
let persistCalls: Array<{ orgId: string; fields: Record<string, unknown> }>;
let commissionCalls: Array<Record<string, unknown>>;
let orgSellerId: string | null;
let useRealCommission: boolean;   // delegate to the real recordCommission (35 % computation)
let commissionRows: Array<{ subscriptionId: unknown; invoiceId: unknown; eligible: unknown; bps: unknown; amount: unknown }>;

/** Simulates finalize-checkout FC-4 COMMIT: org row + pending_signup consumed atomically. */
function commitActivation(): void {
  orgCreated = true;
  pendingSignup = false;
}

function pgUuidError(): Error {
  return Object.assign(new Error("invalid input syntax for type uuid"), {
    code: "22P02", routine: "string_to_uuid", severity: "ERROR",
  });
}

async function fakeQuery(sql: string, params: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ");

  // organizations.id is UUID in production: any `WHERE id = $1` on organizations
  // with a non-UUID parameter raises 22P02 (string_to_uuid).
  if (/organizations\b.*\bWHERE id ?= ?\$1/i.test(s) || /UPDATE organizations SET .* WHERE id ?= ?\$1/i.test(s)) {
    uuidQueries.push({ sql: s.slice(0, 80), id: params[0] });
    if (!UUID_RE.test(String(params[0]))) throw pgUuidError();
    if (/SELECT seller_id, owner_email, plan FROM organizations/i.test(s)) {
      return { rows: orgCreated ? [{ seller_id: orgSellerId, owner_email: EMAIL, plan: "standard" }] : [], rowCount: orgCreated ? 1 : 0 };
    }
    if (/SELECT plan FROM organizations/i.test(s)) {
      return { rows: orgCreated ? [{ plan: "standard" }] : [], rowCount: orgCreated ? 1 : 0 };
    }
    return { rows: [], rowCount: orgCreated ? 1 : 0 };
  }

  // Combined canonical org + pending signup snapshot (fix helper).
  if (/pending_signups/i.test(s) && /organizations/i.test(s)) {
    return { rows: [{ org_id: orgCreated ? ORG_UUID : null, pending: pendingSignup }], rowCount: 1 };
  }
  // Existing owner_email canonicalization.
  if (/SELECT id FROM organizations WHERE lower\(owner_email\)/i.test(s)) {
    return { rows: orgCreated ? [{ id: ORG_UUID }] : [], rowCount: orgCreated ? 1 : 0 };
  }
  if (/SELECT plan FROM org_settings/i.test(s)) return { rows: [], rowCount: 0 };
  if (/SELECT id FROM seller_commissions/i.test(s)) return { rows: [], rowCount: 0 };
  if (/INSERT INTO seller_commissions/i.test(s)) {
    commissionRows.push({ subscriptionId: params[4], invoiceId: params[6], eligible: params[9], bps: params[10], amount: params[11] });
    return { rows: [], rowCount: 1 };
  }

  // Idempotency claim / finalize (claim-then-finalize protocol).
  if (/INSERT INTO billing_events/i.test(s)) {
    const [orgId, , eventId] = params as [string, string, string];
    const existing = billingEvents.get(eventId);
    if (existing && existing.status === "processed") return { rows: [], rowCount: 0 };
    billingEvents.set(eventId, { status: "processing", orgId });
    return { rows: [{ status: "processing" }], rowCount: 1 };
  }
  if (/UPDATE billing_events/i.test(s)) {
    const [eventId, status] = params as [string, string];
    const e = billingEvents.get(eventId);
    if (e) e.status = status;
    return { rows: [], rowCount: e ? 1 : 0 };
  }
  return { rows: [], rowCount: 0 };
}

// ── Mocks (declared before importing the router) ─────────────────────────────
vi.mock("@workspace/db", () => {
  const client = { query: vi.fn((sql: string, p?: unknown[]) => fakeQuery(sql, p)), release: vi.fn() };
  return {
    pool: { connect: vi.fn(async () => client), query: vi.fn((sql: string, p?: unknown[]) => fakeQuery(sql, p)) },
    db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn(),
  };
});

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/stripe-factory.js", () => ({
  getStripeKey: vi.fn(() => undefined),       // dev path: no signature, no Stripe API calls
  createStripeClient: vi.fn(async () => null),
}));

vi.mock("../services/org-data.js", () => ({
  // Mirrors production: before FC-4 the customer is only linked in
  // org_settings (key = email); after FC-4 organizations.stripe_customer_id wins.
  findOrgByStripeCustomer: vi.fn(async () => (orgCreated ? ORG_UUID : EMAIL)),
  persistOrgData: vi.fn(async (orgId: string, fields: Record<string, unknown>) => {
    persistCalls.push({ orgId, fields });
  }),
  loadOrgData: vi.fn(async () => ({ email: EMAIL, firstName: "New", plan: "standard" })),
}));

vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => (trialAlreadyConsumed ? { trialConsumedAt: "2026-09-12T14:17:39.000Z" } : null)),
  upsertOrgSettings: vi.fn(async () => {}),
}));

vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async (_k: string, orgId: string) => {
    if (!UUID_RE.test(orgId)) throw pgUuidError();
    return true;
  }),
  deactivateAddon: vi.fn(async () => true),
  provisionPlanAddons: vi.fn(async () => {}),
}));

vi.mock("../services/mailer.js", () => ({
  mailer: {
    sendPaymentSucceeded: vi.fn(async () => ({ ok: true })),
    sendPaymentFailed:    vi.fn(async () => ({ ok: true })),
    sendPlanChanged:      vi.fn(async () => ({ ok: true })),
    sendWelcome:          vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock("../services/store.js", () => ({
  store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() },
}));

vi.mock("../services/seller-attribution.js", async () => {
  const actual = await vi.importActual<typeof import("../services/seller-attribution.js")>("../services/seller-attribution.js");
  return {
    recordCommission: vi.fn(async (args: Parameters<typeof actual.recordCommission>[0]) => {
      commissionCalls.push(args as unknown as Record<string, unknown>);
      if (useRealCommission) await actual.recordCommission(args);
    }),
  };
});

// ── Harness ──────────────────────────────────────────────────────────────────
type FakeRes = { statusCode: number; body: unknown; status(c: number): FakeRes; json(b: unknown): FakeRes };

async function deliver(event: Record<string, unknown>): Promise<FakeRes> {
  const { default: router } = await import("../routes/stripe-webhook.js");
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === "/webhooks/stripe");
  const res: FakeRes = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = { headers: {}, body: event, rawBody: Buffer.from(JSON.stringify(event)) };
  await layer!.route!.stack[0]!.handle(req, res);
  return res;
}

function subscriptionCreated(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt_TESTRACE_SUB_CREATED",
    type: "customer.subscription.created",
    data: {
      object: {
        id: SUB, object: "subscription", customer: CUS, status: "trialing",
        trial_end: Math.floor(Date.parse("2026-09-26T14:17:39Z") / 1000),
        // Legacy pre-registration metadata written by finalize-checkout (email, not UUID).
        metadata: { plan: "standard", orgId: EMAIL, org_id: EMAIL, pre_register_token: "3afd9c88" },
        items: { data: [] },
        ...overrides,
      },
    },
  };
}

beforeEach(async () => {
  const { logger } = await import("../lib/logger.js");
  vi.mocked(logger.error).mockClear();
  orgCreated = false;
  pendingSignup = true;
  trialAlreadyConsumed = false;
  orgSellerId = null;
  billingEvents = new Map();
  uuidQueries = [];
  persistCalls = [];
  commissionCalls = [];
  useRealCommission = false;
  commissionRows = [];
});

// ─────────────────────────────────────────────────────────────────────────────
describe("STRIPE_WEBHOOK_ORG_RACE — customer.subscription.created before FC-4 commit", () => {
  it("REPRO: email org identifier + webhook before UUID org exists → processed on the canonical UUID, no 22P02, no retry needed", async () => {
    // finalize-checkout commits the organization ~300ms after the webhook arrives
    setTimeout(commitActivation, 300);

    const res = await deliver(subscriptionCreated());

    // The production failure: handler aborted with PostgreSQL 22P02 (string_to_uuid)
    const { logger } = await import("../lib/logger.js");
    const uuidFailures = vi.mocked(logger.error).mock.calls
      .filter((c) => (c[0] as { handlerErr?: { code?: string } })?.handlerErr?.code === "22P02");
    expect(uuidFailures).toEqual([]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    // Every UUID-typed query received the canonical organizations.id
    expect(uuidQueries.length).toBeGreaterThan(0);
    for (const q of uuidQueries) expect(q.id).toBe(ORG_UUID);
    // Subscription state persisted on the canonical organization, never on the email key
    expect(persistCalls.map((c) => c.orgId)).toEqual([ORG_UUID]);
    expect(persistCalls[0]!.fields).toMatchObject({
      subscriptionStatus: "trialing", stripeSubscriptionId: SUB, plan: "standard",
    });
    // Idempotency row keyed on the canonical org and finalized
    expect(billingEvents.get("evt_TESTRACE_SUB_CREATED")).toEqual({ status: "processed", orgId: ORG_UUID });
  });

  it("first real trial: trial_consumed_at / trial_started_at / trial_ends_at written on the UUID org", async () => {
    setTimeout(commitActivation, 100);
    await deliver(subscriptionCreated());
    const fields = persistCalls[0]!.fields;
    expect(persistCalls[0]!.orgId).toBe(ORG_UUID);
    expect(fields["trialConsumedAt"]).toBeTypeOf("string");
    expect(fields["trialStartedAt"]).toBeTypeOf("string");
    expect(fields["trialEndsAt"]).toBe("2026-09-26T14:17:39.000Z");
  });

  it("trial already consumed: no second trial stamp, still canonical", async () => {
    trialAlreadyConsumed = true;
    setTimeout(commitActivation, 100);
    const res = await deliver(subscriptionCreated());
    expect(res.statusCode).toBe(200);
    expect(persistCalls[0]!.orgId).toBe(ORG_UUID);
    expect(persistCalls[0]!.fields["trialConsumedAt"]).toBeUndefined();
  });

  it("retry/idempotency: a second delivery of the processed event is a no-op", async () => {
    setTimeout(commitActivation, 100);
    const first = await deliver(subscriptionCreated());
    expect(first.statusCode).toBe(200);
    const writes = persistCalls.length;

    const second = await deliver(subscriptionCreated());
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });
    expect(persistCalls.length).toBe(writes);
  });

  it("metadata-only resolution (customer not linked yet) also waits and resolves to the UUID org", async () => {
    const { findOrgByStripeCustomer } = await import("../services/org-data.js");
    vi.mocked(findOrgByStripeCustomer).mockImplementationOnce(async () => null);
    setTimeout(commitActivation, 150);
    const res = await deliver(subscriptionCreated());
    expect(res.statusCode).toBe(200);
    expect(persistCalls.map((c) => c.orgId)).toEqual([ORG_UUID]);
  });

  it("customer.subscription.updated in the same window is also resolved canonically", async () => {
    setTimeout(commitActivation, 150);
    const ev = subscriptionCreated();
    ev["id"] = "evt_TESTRACE_SUB_UPDATED";
    ev["type"] = "customer.subscription.updated";
    const res = await deliver(ev);
    expect(res.statusCode).toBe(200);
    for (const q of uuidQueries) expect(q.id).toBe(ORG_UUID);
    // Without the fix the update lands on the email key (org_settings only),
    // leaving the canonical organizations row without the subscription state.
    expect(persistCalls.map((c) => c.orgId)).toEqual([ORG_UUID]);
  });

  it("activation never commits: explicit 503 before any claim or write (no 22P02, no email-keyed billing row)", async () => {
    const res = await deliver(subscriptionCreated());
    expect(res.statusCode).toBe(503);
    expect(uuidQueries).toEqual([]);
    expect(persistCalls).toEqual([]);
    expect(billingEvents.size).toBe(0);
  }, 15_000);

  it("org already activated when the webhook arrives: resolved immediately (unchanged path)", async () => {
    commitActivation();
    const started = Date.now();
    const res = await deliver(subscriptionCreated());
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(persistCalls.map((c) => c.orgId)).toEqual([ORG_UUID]);
  });
});

describe("STRIPE_WEBHOOK_ORG_RACE — scope and non-regression", () => {
  it("legacy email-keyed org without pending signup: no wait, behavior unchanged", async () => {
    pendingSignup = false; // no activation in flight
    const started = Date.now();
    const ev = subscriptionCreated({ status: "active" });
    const res = await deliver(ev);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.statusCode).toBe(200);
    expect(persistCalls.map((c) => c.orgId)).toEqual([EMAIL]);
  });

  it("invoice.payment_succeeded in the window is not delayed (unchanged path)", async () => {
    const started = Date.now();
    const res = await deliver({
      id: "evt_TESTRACE_INV",
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_TEST", customer: CUS, subscription: SUB, amount_paid: 0, billing_reason: "subscription_create" } },
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.statusCode).toBe(200);
  });

  it("seller attribution: first paid invoice on the canonical org still records the commission", async () => {
    commitActivation();
    orgSellerId = "11111111-2222-4333-8444-555555555555";
    const res = await deliver({
      id: "evt_TESTRACE_INV_PAID",
      type: "invoice.payment_succeeded",
      data: { object: {
        id: "in_PAID", customer: CUS, subscription: SUB, amount_paid: 2900, currency: "eur",
        billing_reason: "subscription_cycle", subscription_details: { metadata: {} },
      } },
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50)); // commission path is fire-and-forget
    expect(commissionCalls).toHaveLength(1);
    expect(commissionCalls[0]).toMatchObject({
      sellerId: orgSellerId, orgId: ORG_UUID, eligibleAmountCents: 2900, stripeInvoiceId: "in_PAID",
    });
  });

  it("trial invoice (amount 0) never records a commission", async () => {
    commitActivation();
    orgSellerId = "11111111-2222-4333-8444-555555555555";
    await deliver({
      id: "evt_TESTRACE_INV_TRIAL",
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_TRIAL", customer: CUS, subscription: SUB, amount_paid: 0, billing_reason: "subscription_create" } },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(commissionCalls).toHaveLength(0);
  });
});

describe("awaitPendingSignupActivation", () => {
  it("returns the canonical UUID once activation commits", async () => {
    const { awaitPendingSignupActivation } = await import("../routes/stripe-webhook.js");
    setTimeout(commitActivation, 60);
    await expect(awaitPendingSignupActivation(EMAIL, { timeoutMs: 1000, pollMs: 20 }))
      .resolves.toEqual({ status: "activated", orgId: ORG_UUID });
  });

  it("returns no_pending_signup immediately when nothing is being activated", async () => {
    const { awaitPendingSignupActivation } = await import("../routes/stripe-webhook.js");
    pendingSignup = false;
    await expect(awaitPendingSignupActivation(EMAIL, { timeoutMs: 1000, pollMs: 20 }))
      .resolves.toEqual({ status: "no_pending_signup" });
  });

  it("returns timeout when activation does not commit in time", async () => {
    const { awaitPendingSignupActivation } = await import("../routes/stripe-webhook.js");
    await expect(awaitPendingSignupActivation(EMAIL, { timeoutMs: 100, pollMs: 20 }))
      .resolves.toEqual({ status: "timeout" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE_TRIAL_STATUS — a €0 invoice (trial start, add-on trial month) must not
// flip subscription_status to "active": Stripe keeps the subscription trialing
// and customer.subscription.* events own that state. Only a real payment does.
// ─────────────────────────────────────────────────────────────────────────────
describe("INVOICE_TRIAL_STATUS — invoice.payment_succeeded and €0 trial invoices", () => {
  const invoice = (id: string, o: Record<string, unknown>) => ({
    id, type: "invoice.payment_succeeded",
    data: { object: { id: `in_${id}`, customer: CUS, subscription: SUB, currency: "eur", subscription_details: { metadata: {} }, ...o } },
  });
  const statusWrites = () => persistCalls.filter((c) => c.fields["subscriptionStatus"] !== undefined);

  it("REPRO: €0 subscription_create invoice on the canonical org does not write active (stays trialing)", async () => {
    commitActivation();
    orgSellerId = "11111111-2222-4333-8444-555555555555";
    const res = await deliver(invoice("evt_INV_TRIAL0", { amount_paid: 0, billing_reason: "subscription_create" }));
    expect(res.statusCode).toBe(200);
    expect(statusWrites()).toEqual([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(commissionCalls).toHaveLength(0);
  });

  it("€0 invoice inside the activation window writes nothing on the email key", async () => {
    const res = await deliver(invoice("evt_INV_WINDOW0", { amount_paid: 0, billing_reason: "subscription_create" }));
    expect(res.statusCode).toBe(200);
    expect(statusWrites()).toEqual([]);
  });

  it("€0 add-on subscription trial invoice does not flip the plan status", async () => {
    commitActivation();
    const res = await deliver(invoice("evt_INV_ADDON0", {
      amount_paid: 0, billing_reason: "subscription_create", subscription_details: { metadata: { addonSub: "true" } },
    }));
    expect(res.statusCode).toBe(200);
    expect(statusWrites()).toEqual([]);
  });

  it("first real payment after trial (subscription_cycle, €29) → active on the UUID org + one commission on 2900", async () => {
    commitActivation();
    orgSellerId = "11111111-2222-4333-8444-555555555555";
    const res = await deliver(invoice("evt_INV_FIRSTPAID", { amount_paid: 2900, billing_reason: "subscription_cycle" }));
    expect(res.statusCode).toBe(200);
    expect(statusWrites()).toEqual([{ orgId: ORG_UUID, fields: { subscriptionStatus: "active" } }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(commissionCalls).toHaveLength(1);
    expect(commissionCalls[0]).toMatchObject({ orgId: ORG_UUID, eligibleAmountCents: 2900 });
  });

  it("replay of an already-processed paid invoice: duplicate no-op, no write, no second commission", async () => {
    // Seed the idempotency row as a completed first delivery. (Driving two real
    // deliveries here trips a vitest mock race between the commission task's and
    // markEventStatus' concurrent `import("@workspace/db")` — test-harness only.)
    commitActivation();
    orgSellerId = "11111111-2222-4333-8444-555555555555";
    billingEvents.set("evt_INV_REPLAY", { status: "processed", orgId: ORG_UUID });
    const res = await deliver(invoice("evt_INV_REPLAY", { amount_paid: 2900, billing_reason: "subscription_cycle" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(persistCalls).toEqual([]);
    expect(commissionCalls).toHaveLength(0);
  });

  it("paid recovery / renewal (amount > 0) still marks the subscription active", async () => {
    commitActivation();
    const res = await deliver(invoice("evt_INV_RECOVERY", { amount_paid: 2900, billing_reason: "manual" }));
    expect(res.statusCode).toBe(200);
    expect(statusWrites()).toEqual([{ orgId: ORG_UUID, fields: { subscriptionStatus: "active" } }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE_INVOICE_SCHEMA_COMPAT — Stripe API ≥ 2025-03-31.basil moved
//   invoice.subscription / invoice.subscription_details → invoice.parent.subscription_details
//   invoice line price (line.price.id)                    → line.pricing.price_details.price
// The webhook must read the current shape first and still accept legacy events.
// ─────────────────────────────────────────────────────────────────────────────
describe("STRIPE_INVOICE_SCHEMA_COMPAT — current and legacy invoice shapes", () => {
  const PLAN_PRICE  = "price_1StVzQ9eqtbj6iPBNOLjgwHm";   // Standard (plans.ts default)
  const ADDON_PRICE = "price_E2E_NOT_A_PLAN";
  const current = (o: Record<string, unknown>, meta: Record<string, string> = {}) => ({
    object: "invoice", id: "in_CUR", customer: CUS, currency: "eur",
    parent: { type: "subscription_details", subscription_details: { subscription: SUB, metadata: meta } },
    ...o,
  });
  const legacy = (o: Record<string, unknown>, meta: Record<string, string> = {}) => ({
    object: "invoice", id: "in_LEG", customer: CUS, currency: "eur",
    subscription: SUB, subscription_details: { metadata: meta },
    ...o,
  });
  const ev = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, data: { object } });
  const SELLER = "11111111-2222-4333-8444-555555555555";
  const settle = () => new Promise((r) => setTimeout(r, 60));

  it("current format: first paid Standard invoice → commission with subscription id, 3500 bps, 10,15 €", async () => {
    commitActivation(); orgSellerId = SELLER; useRealCommission = true;
    const res = await deliver(ev("evt_CUR_PAID", "invoice.payment_succeeded", current({ amount_paid: 2900, billing_reason: "subscription_cycle" })));
    await settle();
    expect(res.statusCode).toBe(200);
    expect(commissionCalls).toHaveLength(1);
    expect(commissionCalls[0]).toMatchObject({ stripeSubscriptionId: SUB, eligibleAmountCents: 2900, orgId: ORG_UUID });
    expect(commissionRows).toEqual([{ subscriptionId: SUB, invoiceId: "in_CUR", eligible: 2900, bps: 3500, amount: 1015 }]);
  });

  it("legacy format: same result (subscription id from invoice.subscription)", async () => {
    commitActivation(); orgSellerId = SELLER; useRealCommission = true;
    await deliver(ev("evt_LEG_PAID", "invoice.payment_succeeded", legacy({ amount_paid: 2900, billing_reason: "subscription_cycle" })));
    await settle();
    expect(commissionRows).toEqual([{ subscriptionId: SUB, invoiceId: "in_LEG", eligible: 2900, bps: 3500, amount: 1015 }]);
  });

  it("current format: add-on subscription invoice (metadata.addonSub) → no commission", async () => {
    commitActivation(); orgSellerId = SELLER;
    await deliver(ev("evt_CUR_ADDON", "invoice.payment_succeeded", current({ amount_paid: 1900, billing_reason: "subscription_cycle" }, { addonSub: "true", orgId: ORG_UUID })));
    await settle();
    expect(commissionCalls).toHaveLength(0);
  });

  it("legacy format: add-on subscription invoice → no commission", async () => {
    commitActivation(); orgSellerId = SELLER;
    await deliver(ev("evt_LEG_ADDON", "invoice.payment_succeeded", legacy({ amount_paid: 1900, billing_reason: "subscription_cycle" }, { addonSub: "true" })));
    await settle();
    expect(commissionCalls).toHaveLength(0);
  });

  it("current format: trial 0 € invoice → no commission, status not forced active", async () => {
    commitActivation(); orgSellerId = SELLER;
    await deliver(ev("evt_CUR_TRIAL0", "invoice.payment_succeeded", current({ amount_paid: 0, billing_reason: "subscription_create" })));
    await settle();
    expect(commissionCalls).toHaveLength(0);
    expect(persistCalls.filter((c) => c.fields["subscriptionStatus"] !== undefined)).toEqual([]);
  });

  it("replay of an already-processed paid invoice → no second commission", async () => {
    commitActivation(); orgSellerId = SELLER;
    billingEvents.set("evt_CUR_REPLAY", { status: "processed", orgId: ORG_UUID });
    const res = await deliver(ev("evt_CUR_REPLAY", "invoice.payment_succeeded", current({ amount_paid: 2900, billing_reason: "subscription_cycle" })));
    await settle();
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(commissionCalls).toHaveLength(0);
  });

  it("current format: org fallback resolution from the subscription metadata snapshot", async () => {
    commitActivation();
    const { findOrgByStripeCustomer } = await import("../services/org-data.js");
    vi.mocked(findOrgByStripeCustomer).mockImplementationOnce(async () => null);
    await deliver(ev("evt_CUR_FALLBACK", "invoice.payment_succeeded", current({ amount_paid: 2900, billing_reason: "manual" }, { orgId: ORG_UUID })));
    expect(persistCalls).toEqual([{ orgId: ORG_UUID, fields: { subscriptionStatus: "active" } }]);
  });

  it("legacy format: org fallback resolution still works", async () => {
    commitActivation();
    const { findOrgByStripeCustomer } = await import("../services/org-data.js");
    vi.mocked(findOrgByStripeCustomer).mockImplementationOnce(async () => null);
    await deliver(ev("evt_LEG_FALLBACK", "invoice.payment_succeeded", legacy({ amount_paid: 2900, billing_reason: "manual" }, { orgId: ORG_UUID })));
    expect(persistCalls).toEqual([{ orgId: ORG_UUID, fields: { subscriptionStatus: "active" } }]);
  });

  describe("subscription_update email routing", () => {
    beforeEach(async () => {
      const { mailer } = await import("../services/mailer.js");
      vi.mocked(mailer.sendPlanChanged).mockClear();
      vi.mocked(mailer.sendPaymentSucceeded).mockClear();
    });
    const lineCurrent = (price: string) => ({ pricing: { type: "price_details", price_details: { price, product: "prod_X" } } });
    const lineLegacy  = (price: string) => ({ price: { id: price } });
    const sent = async () => {
      const { mailer } = await import("../services/mailer.js");
      return {
        plan: vi.mocked(mailer.sendPlanChanged).mock.calls.length,
        addon: vi.mocked(mailer.sendPaymentSucceeded).mock.calls.filter((c) => (c[0] as { isAddon?: boolean }).isAddon).length,
      };
    };

    it("current format: plan price line → plan-changed email", async () => {
      commitActivation();
      await deliver(ev("evt_CUR_UPD_PLAN", "invoice.payment_succeeded", current({ amount_paid: 7000, billing_reason: "subscription_update", lines: { data: [lineCurrent(PLAN_PRICE)] } })));
      expect(await sent()).toEqual({ plan: 1, addon: 0 });
    });

    it("current format: add-on-only lines → add-on email", async () => {
      commitActivation();
      await deliver(ev("evt_CUR_UPD_ADDON", "invoice.payment_succeeded", current({ amount_paid: 900, billing_reason: "subscription_update", lines: { data: [lineCurrent(ADDON_PRICE)] } })));
      expect(await sent()).toEqual({ plan: 0, addon: 1 });
    });

    it("current format: addonSub metadata → add-on email", async () => {
      commitActivation();
      await deliver(ev("evt_CUR_UPD_ADDONSUB", "invoice.payment_succeeded", current({ amount_paid: 900, billing_reason: "subscription_update", lines: { data: [lineCurrent(PLAN_PRICE)] } }, { addonSub: "true" })));
      expect(await sent()).toEqual({ plan: 0, addon: 1 });
    });

    it("legacy format: plan price line → plan-changed email", async () => {
      commitActivation();
      await deliver(ev("evt_LEG_UPD_PLAN", "invoice.payment_succeeded", legacy({ amount_paid: 7000, billing_reason: "subscription_update", lines: { data: [lineLegacy(PLAN_PRICE)] } })));
      expect(await sent()).toEqual({ plan: 1, addon: 0 });
    });
  });
});
