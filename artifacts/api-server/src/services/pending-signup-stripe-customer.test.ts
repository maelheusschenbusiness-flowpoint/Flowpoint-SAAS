import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

type SignupRow = {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  country: string;
  address: string;
  city: string;
  postal_code: string;
  stripe_customer_id: string | null;
};

const TOKEN = "c".repeat(64);
let signup: SignupRow;
let sqlLog: string[];

function answer(sql: string, values: unknown[] = []) {
  const normalized = sql.replace(/\s+/g, " ").trim();
  sqlLog.push(normalized);
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [], rowCount: 0 };
  if (/SELECT email, first_name, last_name, company_name/i.test(normalized)) {
    return { rows: [{ ...signup }], rowCount: 1 };
  }
  if (/UPDATE pending_signups SET stripe_customer_id/i.test(normalized)) {
    signup.stripe_customer_id = String(values[0]);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => {
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => answer(sql, values)),
    release: vi.fn(),
  };
  return {
    pool: {
      connect: vi.fn(async () => client),
    },
  };
});

const { ensurePendingSignupStripeCustomer } = await import("./pending-signup-stripe-customer.js");

function makeStripe(opts: { subscriptionHistory?: boolean } = {}) {
  let pmCustomer: string | null = null;
  const customers = new Map<string, any>();
  const fake = {
    created: [] as { params: any; options: any }[],
    updated: [] as { id: string; params: any }[],
    customers: {
      retrieve: vi.fn(async (id: string) => {
        const customer = customers.get(id);
        if (!customer) throw new Error(`No such customer: ${id}`);
        return customer;
      }),
      list: vi.fn(async () => ({ data: [...customers.values()] })),
      create: vi.fn(async (params: any, options: any) => {
        fake.created.push({ params, options });
        const customer = {
          id: "cus_signup_e2e",
          email: params.email,
          metadata: { ...params.metadata },
          deleted: false,
        };
        customers.set(customer.id, customer);
        return customer;
      }),
      update: vi.fn(async (id: string, params: any) => {
        fake.updated.push({ id, params });
        const customer = customers.get(id);
        if (customer) customer.metadata = { ...customer.metadata, ...params.metadata };
        return customer ?? {};
      }),
    },
    paymentMethods: {
      retrieve: vi.fn(async () => ({ id: "pm_validated", customer: pmCustomer })),
      attach: vi.fn(async (_id: string, params: { customer: string }) => {
        pmCustomer = params.customer;
        return {};
      }),
    },
    subscriptions: {
      list: vi.fn(async () => ({
        data: opts.subscriptionHistory ? [{ id: "sub_prior" }] : [],
      })),
    },
  };
  return fake;
}

beforeEach(() => {
  signup = {
    email: "checkout-retry@example.test",
    first_name: "Checkout",
    last_name: "Retry",
    company_name: "Example",
    country: "BE",
    address: "Main street 1",
    city: "Brussels",
    postal_code: "1000",
    stripe_customer_id: null,
  };
  sqlLog = [];
});

describe("ensurePendingSignupStripeCustomer", () => {
  it("creates and anchors one Customer only when called after an intent is confirmed", async () => {
    const stripe = makeStripe();

    const first = await ensurePendingSignupStripeCustomer(
      stripe as unknown as Stripe,
      TOKEN,
      "pm_validated",
      null,
      "SELLER-TEST",
    );
    const retry = await ensurePendingSignupStripeCustomer(
      stripe as unknown as Stripe,
      TOKEN,
      "pm_validated",
      null,
      "SELLER-TEST",
    );

    expect(first).toEqual({ customerId: "cus_signup_e2e", hasSubscriptionHistory: false });
    expect(retry).toEqual(first);
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(stripe.customers.list).toHaveBeenCalledTimes(1);
    expect(stripe.created[0]!.options.idempotencyKey).not.toContain(TOKEN);
    expect(stripe.created[0]!.params.email).toBe(signup.email);
    expect(signup.stripe_customer_id).toBe("cus_signup_e2e");
    expect(stripe.paymentMethods.attach).toHaveBeenCalledTimes(1);
    expect(stripe.updated.at(-1)?.params.metadata).toEqual({
      seller_id: "SELLER-TEST",
      seller_attribution: "ref_link",
    });
    expect(sqlLog.filter((sql) => sql === "COMMIT")).toHaveLength(2);
  });

  it("uses actual subscription history rather than Customer existence to decide trial eligibility", async () => {
    const stripe = makeStripe({ subscriptionHistory: true });
    const result = await ensurePendingSignupStripeCustomer(
      stripe as unknown as Stripe,
      TOKEN,
      null,
    );

    expect(result).toEqual({ customerId: "cus_signup_e2e", hasSubscriptionHistory: true });
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the intent Customer conflicts with the pending signup anchor", async () => {
    signup.stripe_customer_id = "cus_canonical";
    const stripe = makeStripe();

    await expect(
      ensurePendingSignupStripeCustomer(
        stripe as unknown as Stripe,
        TOKEN,
        "pm_validated",
        "cus_other",
      ),
    ).rejects.toThrow("pending_signup_customer_mismatch");
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(sqlLog).toContain("ROLLBACK");
  });
});
