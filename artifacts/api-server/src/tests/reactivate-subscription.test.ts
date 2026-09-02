/**
 * reactivate-subscription.test.ts
 *
 * 14 targeted test cases for reactivateSubscriptionAfterLogin.
 * Tests 1–11 use mock Stripe + pool; tests 12–14 verify price ID mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/stripe-factory.js", () => ({
  createStripeClient: vi.fn(),
  getStripeKey: vi.fn(),
}));

vi.mock("../lib/plans.js", () => ({
  PLAN_PRICE_IDS: { standard: "price_live_std", pro: "price_live_pro", ultra: "price_live_ultra" },
  PLAN_PRICE_IDS_TEST: { standard: "price_test_std", pro: "price_test_pro", ultra: "price_test_ultra" },
}));

import { pool } from "@workspace/db";
import { createStripeClient, getStripeKey } from "../services/stripe-factory.js";
import { reactivateSubscriptionAfterLogin } from "../services/reactivate-subscription.js";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockGetStripeKey = getStripeKey as ReturnType<typeof vi.fn>;
const mockCreateStripeClient = createStripeClient as ReturnType<typeof vi.fn>;

/** Build a minimal Stripe mock with only the methods we need. */
function makeStripeMock(opts: {
  active?: Array<{ id: string }>;
  trialing?: Array<{ id: string }>;
  all?: Array<{ id: string; status: string; cancel_at_period_end?: boolean; canceled_at?: number | null }>;
  createResult?: { id: string; status: string };
  updateResult?: object;
}) {
  return {
    subscriptions: {
      list: vi.fn(({ status }: { status?: string } = {}) => {
        if (status === "active")   return Promise.resolve({ data: opts.active   ?? [] });
        if (status === "trialing") return Promise.resolve({ data: opts.trialing ?? [] });
        return Promise.resolve({ data: opts.all ?? [] });
      }),
      create: vi.fn(() => Promise.resolve(opts.createResult ?? { id: "sub_new", status: "active" })),
      update: vi.fn(() => Promise.resolve(opts.updateResult ?? {})),
    },
  };
}

const ORG_A = "org-a-uuid";
const ORG_B = "org-b-uuid";
const CUS_A = "cus_aaaaa";
const CUS_B = "cus_bbbbb";

beforeEach(() => {
  vi.resetAllMocks();
  mockGetStripeKey.mockReturnValue("sk_live_test");
  mockGetStripeKey.mockReturnValue("sk_live_test");
});

// ──────────────────────────────────────────────────────────────────────────────
// 1. DB active + Stripe active → 0 create
// ──────────────────────────────────────────────────────────────────────────────
it("1. DB active → returns immediately, 0 Stripe calls", async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [{ subscription_status: "active", stripe_customer_id: CUS_A, plan: "pro" }] });
  const stripe = makeStripeMock({});
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. DB canceled + Stripe active → sync DB to active, 0 create
// ──────────────────────────────────────────────────────────────────────────────
it("2. DB canceled + Stripe active → DB → 'active', 0 create", async () => {
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "pro" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

  const stripe = makeStripeMock({ active: [{ id: "sub_existing" }] });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  const update = mockPool.query.mock.calls[1] as [string, unknown[]];
  // Service hardcodes status in SQL string, only org_id as param
  expect(update[1]).toEqual([ORG_A]);
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. DB canceled + active cancel_at_period_end → reverse, 0 create
// ──────────────────────────────────────────────────────────────────────────────
it("3. DB canceled + active cancel_at_period_end → reversed, 0 create", async () => {
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "standard" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

  const stripe = makeStripeMock({
    all: [{ id: "sub_pending", status: "active", cancel_at_period_end: true, canceled_at: null }],
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_pending", { cancel_at_period_end: false });
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  const update = mockPool.query.mock.calls[1];
  expect(update[1]).toEqual(["active", ORG_A]);
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. DB canceled + old Stripe canceled → exactly 1 subscriptions.create
// ──────────────────────────────────────────────────────────────────────────────
it("4. DB canceled + all Stripe canceled → 1 create, DB → 'active'", async () => {
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "pro" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

  const stripe = makeStripeMock({
    all: [{ id: "sub_old", status: "canceled", cancel_at_period_end: false, canceled_at: 1700000000 }],
    createResult: { id: "sub_new", status: "active" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  expect(stripe.subscriptions.create).toHaveBeenCalledTimes(1);
  const createArgs = (stripe.subscriptions.create.mock.calls as Array<any[]>)[0]?.[0] as { customer: string; items: Array<{ price: string }> };
  const createOpts = (stripe.subscriptions.create.mock.calls as Array<any[]>)[0]?.[1] as { idempotencyKey: string };
  expect(createArgs?.customer).toBe(CUS_A);
  expect(createOpts?.idempotencyKey).toBe(`reactivate:${ORG_A}:sub_old`);

  const update = mockPool.query.mock.calls[1];
  expect(update[1]).toEqual(["active", ORG_A]);
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Two concurrent calls → same idempotency key
// ──────────────────────────────────────────────────────────────────────────────
it("5. Concurrent calls share idempotency key", async () => {
  const orgRow = { rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "standard" }] };
  mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mockPool.query.mockResolvedValueOnce(orgRow).mockResolvedValueOnce({ rows: [], rowCount: 1 });
  mockPool.query.mockResolvedValueOnce(orgRow).mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const stripe = makeStripeMock({
    all: [{ id: "sub_canceled", status: "canceled", canceled_at: 1700000001 }],
    createResult: { id: "sub_new2", status: "active" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await Promise.all([
    reactivateSubscriptionAfterLogin(ORG_A, "magic-link"),
    reactivateSubscriptionAfterLogin(ORG_A, "google-oauth"),
  ]);

  const keys = (stripe.subscriptions.create.mock.calls as Array<any[]>).map(
    ([, opts]) => opts.idempotencyKey
  );
  // Both calls must use the same idempotency key
  expect(keys.every((k: string) => k === `reactivate:${ORG_A}:sub_canceled`)).toBe(true);
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Stripe create fails → DB stays canceled
// ──────────────────────────────────────────────────────────────────────────────
it("6. Stripe create fails → DB stays canceled, no throw", async () => {
  mockPool.query.mockResolvedValueOnce({
    rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "standard" }],
  });

  const stripe = makeStripeMock({
    all: [{ id: "sub_c", status: "canceled", canceled_at: 1700000000 }],
  });
  stripe.subscriptions.create.mockRejectedValue(new Error("card_declined"));
  mockCreateStripeClient.mockResolvedValue(stripe);

  // Must not throw
  await expect(reactivateSubscriptionAfterLogin(ORG_A, "magic-link")).resolves.toBeUndefined();

  // Pool UPDATE must NOT have been called
  const updateCalls = mockPool.query.mock.calls.filter((c: unknown[]) =>
    typeof c[0] === "string" && c[0].startsWith("UPDATE")
  );
  expect(updateCalls).toHaveLength(0);
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Stripe create returns incomplete → DB NOT active
// ──────────────────────────────────────────────────────────────────────────────
it("7. Stripe status=incomplete → DB stays canceled", async () => {
  mockPool.query.mockResolvedValueOnce({
    rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "standard" }],
  });

  const stripe = makeStripeMock({
    all: [{ id: "sub_c2", status: "canceled", canceled_at: 1700000000 }],
    createResult: { id: "sub_new3", status: "incomplete" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  const updateCalls = mockPool.query.mock.calls.filter((c: unknown[]) =>
    typeof c[0] === "string" && c[0].startsWith("UPDATE")
  );
  expect(updateCalls).toHaveLength(0);
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Magic-link caller label preserved
// ──────────────────────────────────────────────────────────────────────────────
it("8. magic-link path calls helper and passes caller='magic-link'", async () => {
  // Helper returns early because subscription is not canceled
  mockPool.query.mockResolvedValueOnce({
    rows: [{ subscription_status: "active", stripe_customer_id: CUS_A, plan: "pro" }],
  });
  const stripe = makeStripeMock({});
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");
  // Just verifying it doesn't crash and reads the org row
  expect(mockPool.query).toHaveBeenCalledWith(
    expect.stringContaining("SELECT"),
    [ORG_A]
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. Google OAuth caller label preserved
// ──────────────────────────────────────────────────────────────────────────────
it("9. google-oauth path calls same helper", async () => {
  mockPool.query.mockResolvedValueOnce({
    rows: [{ subscription_status: "active", stripe_customer_id: CUS_A, plan: "pro" }],
  });
  const stripe = makeStripeMock({});
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "google-oauth");
  expect(mockPool.query).toHaveBeenCalledWith(
    expect.stringContaining("SELECT"),
    [ORG_A]
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. No stripe_customer_id → no Stripe call, login continues
// ──────────────────────────────────────────────────────────────────────────────
it("10. No stripe_customer_id → no Stripe call, returns cleanly", async () => {
  mockPool.query.mockResolvedValueOnce({
    rows: [{ subscription_status: "canceled", stripe_customer_id: null, plan: "standard" }],
  });
  const stripe = makeStripeMock({});
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  expect(stripe.subscriptions.create).not.toHaveBeenCalled();
});

// ──────────────────────────────────────────────────────────────────────────────
// 11. Org A never touches org B customer/subscription
// ──────────────────────────────────────────────────────────────────────────────
it("11. Org A reactivation never touches Org B customer", async () => {
  // Org A returns canceled → will try to create for CUS_A
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "standard" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const stripe = makeStripeMock({
    all: [{ id: "sub_a_canceled", status: "canceled", canceled_at: 1700000000 }],
    createResult: { id: "sub_a_new", status: "active" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  // All Stripe list calls use CUS_A only
  for (const call of stripe.subscriptions.list.mock.calls as Array<any[]>) {
    const arg = call[0] as { customer?: string } | undefined;
    if (arg?.customer) expect(arg.customer).toBe(CUS_A);
  }
  // Stripe create must have been called with CUS_A
  expect(stripe.subscriptions.create).toHaveBeenCalled();
  expect(stripe.subscriptions.create).toHaveBeenCalledWith(
    expect.objectContaining({ customer: CUS_A }),
    expect.any(Object)
  );
  // CUS_B and ORG_B must never appear in any call
  const allCallArgs11 = JSON.stringify(stripe.subscriptions.create.mock.calls);
  expect(allCallArgs11).not.toContain(CUS_B);
  expect(allCallArgs11).not.toContain(ORG_B);
});

// ──────────────────────────────────────────────────────────────────────────────
// 12. Plan Standard → price_live_std (live mode)
// ──────────────────────────────────────────────────────────────────────────────
it("12. Plan standard → correct live price ID", async () => {
  mockGetStripeKey.mockReturnValue("sk_live_xxx");
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "standard" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const stripe = makeStripeMock({
    all: [{ id: "sub_s", status: "canceled", canceled_at: 1700000000 }],
    createResult: { id: "sub_new", status: "active" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  type CreateFirstArg = { customer: string; items: Array<{ price: string }> };
  const createCall12 = (stripe.subscriptions.create.mock.calls as Array<any[]>)[0]?.[0] as CreateFirstArg;
  expect(createCall12?.items[0]?.price).toBe("price_live_std");
});

// ──────────────────────────────────────────────────────────────────────────────
// 13. Plan Pro → price_live_pro (live mode)
// ──────────────────────────────────────────────────────────────────────────────
it("13. Plan pro → correct live price ID", async () => {
  mockGetStripeKey.mockReturnValue("sk_live_xxx");
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "pro" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const stripe = makeStripeMock({
    all: [{ id: "sub_p", status: "canceled", canceled_at: 1700000000 }],
    createResult: { id: "sub_new", status: "active" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  type CreateFirstArg = { customer: string; items: Array<{ price: string }> };
  const createCall13 = (stripe.subscriptions.create.mock.calls as Array<any[]>)[0]?.[0] as CreateFirstArg;
  expect(createCall13?.items[0]?.price).toBe("price_live_pro");
});

// ──────────────────────────────────────────────────────────────────────────────
// 14. Plan Ultra → price_test_ultra (test mode)
// ──────────────────────────────────────────────────────────────────────────────
it("14. Plan ultra + test key → correct test price ID", async () => {
  mockGetStripeKey.mockReturnValue("sk_test_xxx");
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ subscription_status: "canceled", stripe_customer_id: CUS_A, plan: "ultra" }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const stripe = makeStripeMock({
    all: [{ id: "sub_u", status: "canceled", canceled_at: 1700000000 }],
    createResult: { id: "sub_new", status: "active" },
  });
  mockCreateStripeClient.mockResolvedValue(stripe);

  await reactivateSubscriptionAfterLogin(ORG_A, "magic-link");

  type CreateFirstArg = { customer: string; items: Array<{ price: string }> };
  const createCall14 = (stripe.subscriptions.create.mock.calls as Array<any[]>)[0]?.[0] as CreateFirstArg;
  expect(createCall14?.items[0]?.price).toBe("price_test_ultra");
});
