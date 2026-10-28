import { afterEach, describe, expect, it, vi } from "vitest";
import { getStripeKey, isStripeTestMode, setStripeForTesting } from "./stripe-factory.js";
import { getInvoices, startTrial, validateCoupon } from "./billing-service.js";

vi.mock("stripe", () => ({
  default: class StripeBypassGuard {
    constructor() {
      throw new Error("Stripe SDK was constructed outside stripe-factory");
    }
  },
}));

const fakeStripe = {
  coupons: {
    retrieve: vi.fn(async (id: string) => ({
      id,
      valid: true,
      name: "Fixture coupon",
      percent_off: 15,
      amount_off: null,
      duration: "once",
    })),
  },
  invoices: {
    list: vi.fn(async () => ({
      data: [{
        id: "in_test_fixture",
        number: "QA-0001",
        amount_paid: 1250,
        amount_due: 0,
        currency: "eur",
        status: "paid",
        created: 1_800_000_000,
        invoice_pdf: null,
        hosted_invoice_url: null,
        period_start: 1_799_000_000,
        period_end: 1_801_000_000,
      }],
    })),
  },
  subscriptions: {
    list: vi.fn(async () => ({ data: [] })),
    create: vi.fn(async () => ({ id: "sub_test_fixture", trial_end: 1_801_000_000 })),
  },
};

afterEach(() => {
  setStripeForTesting(null);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Stripe mode selection", () => {
  it("selects the test key when test mode is explicit, even if a live key exists", () => {
    vi.stubEnv("STRIPE_TEST_MODE", "true");
    vi.stubEnv("STRIPE_TEST_KEY", "sk_test_fixture");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_fixture");

    expect(getStripeKey()).toBe("sk_test_fixture");
  });

  it("treats NODE_ENV=test as test-only and never falls back to a live key", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STRIPE_TEST_MODE", "false");
    vi.stubEnv("STRIPE_TEST_KEY", "");
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_fixture");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");

    expect(isStripeTestMode()).toBe(true);
    expect(getStripeKey()).toBe("");
  });

  it("uses the live key only when the environment is not in test mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STRIPE_TEST_MODE", "false");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_fixture");

    expect(getStripeKey()).toBe("sk_live_fixture");
  });
});

describe("billing-service Stripe reads", () => {
  it("validates coupons and fetches invoices through the injected client", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STRIPE_TEST_MODE", "true");
    vi.stubEnv("STRIPE_TEST_KEY", "sk_test_fixture");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_fixture");
    setStripeForTesting(fakeStripe);

    const coupon = await validateCoupon("coupon_fixture");
    const invoiceResult = await getInvoices(5, "cus_test_fixture");

    expect(coupon).toMatchObject({ valid: true, id: "coupon_fixture", type: "percent", discount: 15 });
    expect(invoiceResult.invoices).toHaveLength(1);
    expect(invoiceResult.invoices[0]).toMatchObject({ id: "in_test_fixture", amount: 12.5 });
    expect(fakeStripe.coupons.retrieve).toHaveBeenCalledWith("coupon_fixture");
    expect(fakeStripe.invoices.list).toHaveBeenCalledWith({ customer: "cus_test_fixture", limit: 5 });
  });

  it("does not activate a mock trial when a test price is missing", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STRIPE_TEST_MODE", "false");
    vi.stubEnv("STRIPE_TEST_KEY", "sk_test_fixture");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_fixture");
    setStripeForTesting(fakeStripe);

    await expect(startTrial("unknown_test_plan", 14, "qa-org"))
      .rejects.toThrow("No test-mode Stripe price configured");
    expect(fakeStripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("fails closed instead of returning a demo coupon when the test key is absent", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STRIPE_TEST_MODE", "true");
    vi.stubEnv("STRIPE_TEST_KEY", "");
    vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_fixture");

    await expect(validateCoupon("FLOWPOINT20")).resolves.toMatchObject({
      valid: false,
      error: "Payment service not configured",
    });
    expect(fakeStripe.coupons.retrieve).not.toHaveBeenCalled();
  });
});
