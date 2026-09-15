/**
 * signup-token-over-stale-session.test.ts
 *
 * P0 2026-09-15: a seller-link signup finished on "account_already_subscribed" when the
 * browser still carried an older FlowPoint session. checkout-payment.html dropped the
 * fresh signup token because /api/me answered 200, and payment-intent let the session's
 * req.orgId (set globally by orgContext from the fp_token cookie) override a valid token.
 * The whole checkout then ran as the old, already-subscribed account.
 *
 * A valid pre-registration token is the identity of THIS checkout; the session is used
 * only when there is no valid token. The existing-subscriber guard is unchanged.
 *
 *  A  no session + valid token          → signup path, new Customer
 *  B  old session + valid token         → token wins, old org / Customer never used
 *  C  session, no token                 → authenticated path unchanged
 *  D  invalid/expired token + session   → falls back to the session (existing rule)
 *  E  different seller code             → no effect on Customer resolution
 *  F  checkout-payment keeps the token; finalize-checkout authenticates with it
 *  G  real subscriber, incompatible plan → still 409 account_already_subscribed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setStripeForTesting } from "../services/stripe-factory.js";
import { logger } from "../lib/logger.js";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const OLD_ORG = "488d7b10-3b1d-40e8-989c-50759cfd3ea8";
const OLD_CUSTOMER = "cus_OLD_SUBSCRIBER";
const NEW_EMAIL = "new.signup@exemple.fr";
const TOKEN_S1 = "a".repeat(64);          // valid, seller S1
const TOKEN_S2 = "b".repeat(64);          // valid, seller S2
const TOKEN_DEAD = "d".repeat(64);        // expired / consumed / unknown → no row

// The old account behind the stale session: Ultra, trialing, trial already consumed.
const loadBillingContext = vi.fn(async (orgId: string) => orgId === OLD_ORG
  ? { plan: "ultra", subscriptionStatus: "trialing", stripeCustomerId: OLD_CUSTOMER, email: "old@exemple.fr", canStartTrial: false, trialEndsAt: null }
  : { plan: null, subscriptionStatus: null, stripeCustomerId: null, email: null, canStartTrial: true, trialEndsAt: null });
vi.mock("../services/billing-context.js", () => ({ loadBillingContext: (o: string) => loadBillingContext(o) }));
vi.mock("../services/sessions.js", () => ({
  getSession: vi.fn(async (t: string) => (t === "tok-old" ? { orgId: OLD_ORG, userId: "user-old" } : null)),
}));
const ensureStripeCustomer = vi.fn(async (orgId: string) => (orgId === OLD_ORG ? OLD_CUSTOMER : null));
vi.mock("../services/ensure-stripe-customer.js", () => ({ ensureStripeCustomer: (o: string) => ensureStripeCustomer(o) }));
vi.mock("../services/seller-attribution.js", () => ({
  resolveSellerIdFromToken: vi.fn(async (t: string) => (t === TOKEN_S1 ? "seller-1" : t === TOKEN_S2 ? "seller-2" : null)),
  validateSellerCode: vi.fn(async () => null),
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const PENDING: Record<string, { email: string; stripe_customer_id: string | null }> = {};
const sessionLookups: string[] = [];
function answer(sql: string, values: unknown[] = []) {
  if (/FROM user_sessions/.test(sql)) {
    sessionLookups.push(String(values[0]));
    return { rows: values[0] === "tok-old" ? [{ org_id: OLD_ORG }] : [], rowCount: values[0] === "tok-old" ? 1 : 0 };
  }
  if (/FROM pending_signups/.test(sql)) {
    const row = PENDING[String(values[0])];
    const full = row ? { ...row, first_name: "Test", last_name: "Dupont", company_name: "Test1", address: null, city: null, postal_code: null, country: "BE" } : null;
    return { rows: full ? [full] : [], rowCount: full ? 1 : 0 };
  }
  if (/UPDATE pending_signups SET stripe_customer_id/.test(sql)) {
    const row = PENDING[String(values[1])]; if (row) row.stripe_customer_id = String(values[0]);
    return { rows: [], rowCount: 1 };
  }
  if (/FROM sellers/.test(sql)) return { rows: [{ seller_code: values[0] === "seller-1" ? "SELLER-S1" : "SELLER-S2" }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}
vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({ query: async (s: string, v: unknown[] = []) => answer(s, v), release: () => {} }),
    query: async (s: string, v: unknown[] = []) => answer(s, v),
  },
}));
vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async () => true), deactivateAddon: vi.fn(async () => true), provisionPlanAddons: vi.fn(async () => {}),
}));

const { default: publicBillingRouter } = await import("../routes/public-billing.js");

/** The real middleware order: orgContext has set req.orgId from the cookie before the router. */
function makeApp(cookieToken?: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.cookies = cookieToken ? { fp_token: cookieToken } : {};
    if (cookieToken === "tok-old") { req.orgId = OLD_ORG; req.orgContext = { orgId: OLD_ORG, email: "old@exemple.fr" }; }
    next();
  });
  app.use("/api", publicBillingRouter);
  return app;
}

function makeFakeStripe(opts: { subsByCustomer?: Record<string, any[]>; intentCustomer?: string; intentMeta?: Record<string, string> } = {}) {
  const f = {
    customersCreated: [] as any[], customersListed: [] as any[], setupCreated: [] as any[], piCreated: [] as any[],
    subsListedFor: [] as string[], subsCreated: [] as any[],
    customers: {
      list: vi.fn(async (p: any) => { f.customersListed.push(p); return { data: [] }; }),
      create: vi.fn(async (p: any) => { f.customersCreated.push(p); return { id: "cus_NEW_SIGNUP", ...p }; }),
      retrieve: vi.fn(async (id: string) => ({ id, deleted: false, name: "x", address: {}, description: "x", metadata: {} })),
      update: vi.fn(async () => ({})),
    },
    setupIntents: {
      create: vi.fn(async (p: any) => { f.setupCreated.push(p); return { id: "seti_fake", client_secret: "seti_fake_secret", ...p }; }),
      retrieve: vi.fn(async (id: string) => ({ id, status: "succeeded", payment_method: "pm_fake", customer: opts.intentCustomer ?? OLD_CUSTOMER, metadata: opts.intentMeta ?? {} })),
    },
    paymentIntents: {
      create: vi.fn(async (p: any) => { f.piCreated.push(p); return { id: "pi_fake", client_secret: "pi_fake_secret", ...p }; }),
      retrieve: vi.fn(async (id: string) => ({ id, status: "succeeded", payment_method: "pm_fake", customer: opts.intentCustomer ?? OLD_CUSTOMER, metadata: opts.intentMeta ?? {} })),
    },
    subscriptions: {
      list: vi.fn(async (p: any) => { f.subsListedFor.push(p.customer); return { data: opts.subsByCustomer?.[p.customer] ?? [] }; }),
      create: vi.fn(async (p: any) => { f.subsCreated.push(p); return { id: "sub_new_fake", status: "trialing", items: { data: [] }, ...p }; }),
    },
    paymentMethods: { attach: vi.fn(async () => ({})), retrieve: vi.fn(async () => ({ customer: opts.intentCustomer ?? OLD_CUSTOMER, billing_details: {} })) },
    subscriptionItems: { create: vi.fn(async () => ({})) },
  };
  return f;
}

/** The customer every intent created by payment-intent is bound to. */
const intentCustomers = (f: ReturnType<typeof makeFakeStripe>) => [...f.setupCreated, ...f.piCreated].map((i) => i.customer);

const PREV_ENV = process.env["NODE_ENV"];
let fake: ReturnType<typeof makeFakeStripe>;
beforeEach(() => {
  process.env["NODE_ENV"] = "test";
  process.env["STRIPE_SECRET_KEY"] ||= "sk_live_dummy_for_tests";
  for (const k of Object.keys(PENDING)) delete PENDING[k];
  PENDING[TOKEN_S1] = { email: NEW_EMAIL, stripe_customer_id: null };
  PENDING[TOKEN_S2] = { email: "other.signup@exemple.fr", stripe_customer_id: null };
  sessionLookups.length = 0;
  loadBillingContext.mockClear(); ensureStripeCustomer.mockClear(); vi.mocked(logger.info).mockClear();
  fake = makeFakeStripe();
  setStripeForTesting(fake as any);
});
afterEach(() => {
  setStripeForTesting(null);
  if (PREV_ENV === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = PREV_ENV;
});

describe("payment-intent: which identity pays", () => {
  it("A — no session + valid token: signup path, new Customer for the signup email", async () => {
    const r = await request(makeApp()).post("/api/public/payment-intent").send({ plan: "standard", addons: {}, preRegisterToken: TOKEN_S1 });
    expect(r.status).toBe(200);
    expect(fake.customersCreated.map((c) => c.email)).toEqual([NEW_EMAIL]);
    expect(intentCustomers(fake)).toEqual(["cus_NEW_SIGNUP"]);
    expect(PENDING[TOKEN_S1]!.stripe_customer_id).toBe("cus_NEW_SIGNUP");
  });

  it("B — old session + valid token of a new signup: the token wins, the old org is never used", async () => {
    const r = await request(makeApp("tok-old")).post("/api/public/payment-intent").send({ plan: "standard", addons: {}, preRegisterToken: TOKEN_S1 });
    expect(r.status).toBe(200);
    expect(intentCustomers(fake)).toEqual(["cus_NEW_SIGNUP"]);
    expect(intentCustomers(fake)).not.toContain(OLD_CUSTOMER);
    expect(fake.customersCreated.map((c) => c.email)).toEqual([NEW_EMAIL]);
    expect(ensureStripeCustomer).not.toHaveBeenCalled();
    expect(loadBillingContext).not.toHaveBeenCalledWith(OLD_ORG); // quote/trial not taken from the old account
    const meta = [...fake.setupCreated, ...fake.piCreated][0].metadata;
    expect(meta.orgId).toBe(NEW_EMAIL);
    expect(meta.pre_register_token).toBe(TOKEN_S1);
    expect(JSON.stringify(meta)).not.toContain(OLD_ORG);
    expect(r.body.quote.trialDays).toBeGreaterThan(0); // the new signup keeps its trial
  });

  it("C — session without token: authenticated path unchanged (old org Customer)", async () => {
    const r = await request(makeApp("tok-old")).post("/api/public/payment-intent").send({ plan: "standard", addons: {} });
    expect(r.status).toBe(200);
    expect(ensureStripeCustomer).toHaveBeenCalledWith(OLD_ORG);
    expect(intentCustomers(fake)).toEqual([OLD_CUSTOMER]);
    expect(fake.customersCreated).toEqual([]);
  });

  it("D — invalid/expired token + valid session: falls back to the session, no signup Customer", async () => {
    const r = await request(makeApp("tok-old")).post("/api/public/payment-intent").send({ plan: "standard", addons: {}, preRegisterToken: TOKEN_DEAD });
    expect(r.status).toBe(200);
    expect(intentCustomers(fake)).toEqual([OLD_CUSTOMER]);
    expect(fake.customersCreated).toEqual([]);
  });

  it("D' — invalid token and no session: still refused (401)", async () => {
    const r = await request(makeApp()).post("/api/public/payment-intent").send({ plan: "standard", addons: {}, preRegisterToken: TOKEN_DEAD });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("INVALID_PRE_REGISTER_TOKEN");
    expect(intentCustomers(fake)).toEqual([]);
  });

  it("E — a different seller code changes nothing in Customer resolution", async () => {
    const r1 = await request(makeApp("tok-old")).post("/api/public/payment-intent").send({ plan: "standard", addons: {}, preRegisterToken: TOKEN_S1 });
    const r2 = await request(makeApp("tok-old")).post("/api/public/payment-intent").send({ plan: "standard", addons: {}, preRegisterToken: TOKEN_S2 });
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(fake.customersListed.map((l) => l.email)).toEqual([NEW_EMAIL, "other.signup@exemple.fr"]);
    expect(fake.customersCreated.map((c) => c.email)).toEqual([NEW_EMAIL, "other.signup@exemple.fr"]);
    expect(intentCustomers(fake)).not.toContain(OLD_CUSTOMER);
  });
});

describe("finalize-checkout: the signup token is received and wins", () => {
  it("F — old session + valid token: authenticates with the token, the session is not even looked up", async () => {
    fake = makeFakeStripe({ intentCustomer: "cus_NEW_SIGNUP", intentMeta: { pre_register_token: TOKEN_S1 } });
    setStripeForTesting(fake as any);
    await request(makeApp("tok-old")).post("/api/public/finalize-checkout")
      .send({ intentId: "seti_fake", intentType: "setup", plan: "standard", addons: {}, preRegisterToken: TOKEN_S1 });
    expect(sessionLookups).toEqual([]);
    expect(vi.mocked(logger.info).mock.calls.some((c) => String(c[1]).includes("Authenticated via preRegisterToken"))).toBe(true);
    expect(fake.subsListedFor).not.toContain(OLD_CUSTOMER);
  });
});

describe("existing-subscriber guard (unchanged)", () => {
  it("G — a real subscriber buying an incompatible plan still gets 409 account_already_subscribed", async () => {
    fake = makeFakeStripe({
      intentCustomer: OLD_CUSTOMER,
      subsByCustomer: { [OLD_CUSTOMER]: [{ id: "sub_existing_ultra", status: "trialing", cancel_at_period_end: false, metadata: { plan: "ultra" },
        items: { data: [{ price: { id: "price_ultra_other" } }] } }] },
    });
    setStripeForTesting(fake as any);
    const r = await request(makeApp("tok-old")).post("/api/public/finalize-checkout")
      .send({ intentId: "seti_fake", intentType: "setup", plan: "standard", addons: {} });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("account_already_subscribed");
    expect(fake.subsCreated).toEqual([]);
  });
});

// ── checkout-payment.html: the real requireAuthenticatedCheckout, run in a sandbox ──
const PAGE = readFileSync(join(import.meta.dirname ?? __dirname, "../../../flowpoint-export/checkout-payment.html"), "utf8");
function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const head = src.lastIndexOf("async ", start) === start - 6 ? start - 6 : start;
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
  return src.slice(head, i + 1);
}
function runGate(opts: { token?: string; meOk: boolean }) {
  const store = (init: Record<string, string>) => ({ m: { ...init }, getItem(k: string) { return k in this.m ? this.m[k] : null; }, setItem(k: string, v: string) { this.m[k] = v; }, removeItem(k: string) { delete this.m[k]; } });
  const sessionStorage = store(opts.token ? { fp_pre_reg_token: opts.token } : {});
  const localStorage = store(opts.token ? { fp_pre_reg_token: JSON.stringify({ token: opts.token, exp: Date.now() + 3600_000 }) } : {});
  const redirects: string[] = [];
  const ctx = vm.createContext({
    sessionStorage, localStorage, JSON, Date, Object, encodeURIComponent, cart: {},
    fetch: async () => ({ ok: opts.meOk }), window: { location: { replace: (u: string) => redirects.push(u) } },
  });
  vm.runInContext(["authHeaders", "preRegisterToken", "rememberCheckoutIntent", "requireAuthenticatedCheckout"].map((n) => extractFunction(PAGE, n)).join("\n") + "\nthis.gate = requireAuthenticatedCheckout;", ctx);
  return { gate: (ctx as any).gate as () => Promise<boolean>, sessionStorage, localStorage, redirects };
}

describe("checkout-payment.html keeps the signup token (F, frontend)", () => {
  it("B/F — /api/me answers 200 (old session) and a signup token exists: the token is kept", async () => {
    const g = runGate({ token: TOKEN_S1, meOk: true });
    expect(await g.gate()).toBe(true);
    expect(g.sessionStorage.getItem("fp_pre_reg_token")).toBe(TOKEN_S1);
    expect(g.localStorage.getItem("fp_pre_reg_token")).not.toBeNull();
    expect(g.redirects).toEqual([]);
  });
  it("C — session and no token: allowed as before", async () => {
    const g = runGate({ meOk: true });
    expect(await g.gate()).toBe(true);
    expect(g.redirects).toEqual([]);
  });
  it("no session and no token: sent to sign-in as before", async () => {
    const g = runGate({ meOk: false });
    expect(await g.gate()).toBe(false);
    expect(g.redirects[0]).toMatch(/^\/signin\.html\?next=/);
  });
  it("the page no longer removes the signup token anywhere", () => {
    expect(PAGE).not.toMatch(/removeItem\('fp_pre_reg_token'\)/);
  });
});
