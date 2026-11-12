import { describe, expect, it, vi } from "vitest";
import { hasStripeSubscriptionHistory } from "./stripe-trial-history.js";

function fakeStripe(options: {
  customers?: Array<{ id: string }>;
  hasMore?: boolean;
  subscriptionsByCustomer?: Record<string, Array<{ id: string }>>;
} = {}) {
  return {
    customers: {
      list: vi.fn(async () => ({
        data: options.customers ?? [],
        has_more: options.hasMore ?? false,
      })),
    },
    subscriptions: {
      list: vi.fn(async ({ customer }: { customer: string }) => ({
        data: options.subscriptionsByCustomer?.[customer] ?? [],
      })),
    },
  };
}

describe("Stripe trial-history guard", () => {
  it("counts a canceled subscription found by email as prior subscription history", async () => {
    const stripe = fakeStripe({
      customers: [{ id: "cus_old" }],
      subscriptionsByCustomer: { cus_old: [{ id: "sub_canceled" }] },
    });

    await expect(hasStripeSubscriptionHistory(stripe, { email: "returning@example.test" }))
      .resolves.toBe(true);
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_old",
      status: "all",
      limit: 1,
    });
  });

  it("checks known customer IDs as well as customers returned by email", async () => {
    const stripe = fakeStripe({
      customers: [{ id: "cus_email" }],
      subscriptionsByCustomer: { cus_email: [], cus_known: [{ id: "sub_old" }] },
    });

    await expect(hasStripeSubscriptionHistory(stripe, {
      email: "returning@example.test",
      customerIds: ["cus_known"],
    })).resolves.toBe(true);
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(2);
  });

  it("allows a genuinely new email with no known customer or subscription", async () => {
    const stripe = fakeStripe();

    await expect(hasStripeSubscriptionHistory(stripe, { email: "new@example.test" }))
      .resolves.toBe(false);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it("fails when email pagination cannot be completed", async () => {
    const stripe = fakeStripe({ customers: [{ id: "cus_last" }], hasMore: true });

    await expect(hasStripeSubscriptionHistory(stripe, { email: "many@example.test" }))
      .rejects.toThrow("TRIAL_CUSTOMER_HISTORY_INCOMPLETE");
  });
});
