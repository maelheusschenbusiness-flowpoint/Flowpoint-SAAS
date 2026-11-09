import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";

const requireApi = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);
const Stripe = requireApi("stripe");
const { Pool } = requireApi("pg");

const BASE_URL = process.env.E2E_BASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const STRIPE_TEST_KEY = process.env.STRIPE_TEST_KEY ?? "";
const STRIPE_TEST_PUBLISHABLE_KEY = process.env.STRIPE_TEST_PUBLISHABLE_KEY ?? "";
const WEBHOOK_SECRET = process.env.STRIPE_TEST_WEBHOOK_SECRET ?? "";
const STANDARD_TEST_PRICE_ID = process.env.STRIPE_TEST_PRICE_ID_STANDARD ?? "";

if (!STRIPE_TEST_KEY.startsWith("sk_test_")) {
  throw new Error("Checkout E2E requires Stripe TEST mode.");
}
if (!STRIPE_TEST_PUBLISHABLE_KEY.startsWith("pk_test_")) {
  throw new Error("Checkout E2E requires the Stripe TEST publishable key.");
}
if (!STANDARD_TEST_PRICE_ID.startsWith("price_")) {
  throw new Error("Checkout E2E requires an existing Stripe TEST Standard price.");
}
if (!WEBHOOK_SECRET) throw new Error("Checkout E2E requires its Stripe TEST webhook secret.");
if (!DATABASE_URL || !new URL(DATABASE_URL).hostname.startsWith("127.0.0.1")) {
  throw new Error("Checkout E2E refuses any database outside the disposable loopback cluster.");
}
if (process.env.STRIPE_LIVE_API_KEY || process.env.STRIPE_SECRET_KEY) {
  throw new Error("Checkout E2E must not receive Stripe LIVE credentials.");
}
if (!BASE_URL || process.env.FLOWPOINT_ADDON_CERT_LOCAL_ONLY !== "1") {
  throw new Error("Checkout E2E requires the guarded local API runner.");
}

const stripe = new Stripe(STRIPE_TEST_KEY, { apiVersion: "2026-04-22.dahlia" });
const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(request, path, body) {
  return request.post(`${BASE_URL}${path}`, { data: body });
}

async function preRegister(request, email) {
  const response = await post(request, "/api/auth/pre-register", {
    firstName: "Checkout",
    lastName: "Test",
    email,
    companyName: "Abandonment E2E",
    country: "BE",
    address: "Test street 1",
    city: "Brussels",
    postalCode: "1000",
  });
  expect(response.status(), "pre-register should accept the test signup").toBe(200);
  return (await response.json()).preRegisterToken;
}

async function createSetupIntent(request, token) {
  const response = await post(request, "/api/public/payment-intent", {
    plan: "standard",
    addons: {},
    preRegisterToken: token,
  });
  expect(response.status(), "setup intent should be created").toBe(200);
  const result = await response.json();
  expect(result.mode).toBe("setup");
  expect(result.setupIntentId).toBeTruthy();
  return result;
}

async function accountState(email) {
  const [users, orgs] = await Promise.all([
    pool.query("SELECT status FROM users WHERE lower(email) = lower($1)", [email]),
    pool.query(
      `SELECT subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id
         FROM organizations WHERE lower(owner_email) = lower($1)`,
      [email],
    ),
  ]);
  return { users: users.rows, orgs: orgs.rows };
}

async function stripeCustomers(email) {
  const result = await stripe.customers.list({ email, limit: 100 });
  return result.data.filter((customer) => !customer.deleted);
}

async function findStripeEvent(type, objectId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const events = await stripe.events.list({ type, limit: 100 });
    const found = events.data.find((event) => event.data.object.id === objectId);
    if (found) return found;
    await pause(500);
  }
  throw new Error(`Stripe TEST event ${type} for ${objectId} did not arrive.`);
}

async function deliverStripeEvent(request, event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return request.post(`${BASE_URL}/api/webhooks/stripe`, {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
  });
}

function uniqueEmail(suffix) {
  return `checkout-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@dev.flowpoint.test`;
}

test.describe.configure({ mode: "serial" });

test("Payment Element abandonment never activates an unconfirmed signup", async ({ request, page }) => {
  test.setTimeout(240_000);

  const abandonedEmail = uniqueEmail("abandon");
  const abandonedToken = await preRegister(request, abandonedEmail);
  const firstAttempt = await createSetupIntent(request, abandonedToken);
  const firstIntent = await stripe.setupIntents.retrieve(firstAttempt.setupIntentId);
  expect(firstIntent.customer).toBeNull();
  expect(await stripeCustomers(abandonedEmail)).toHaveLength(0);
  expect(await accountState(abandonedEmail)).toEqual({ users: [], orgs: [] });

  // Open the real checkout document, then close it without confirming the card.
  await page.addInitScript((token) => {
    sessionStorage.setItem("fp_pre_reg_token", token);
    localStorage.setItem(
      "fp_pre_reg_token",
      JSON.stringify({ token, exp: Date.now() + 60 * 60 * 1000 }),
    );
    localStorage.setItem(
      "fp_cart",
      JSON.stringify({ plan: "standard", addons: {}, _v: 1, _updatedAt: Date.now() }),
    );
  }, abandonedToken);
  await page.goto(`${BASE_URL}/checkout.html`, { waitUntil: "domcontentloaded" });
  const checkoutPage = await page.goto(`${BASE_URL}/checkout-payment.html`, {
    waitUntil: "domcontentloaded",
  });
  expect(checkoutPage?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
  await page.goBack({ waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe("/checkout.html");
  await page.goto(`${BASE_URL}/checkout-payment.html`, { waitUntil: "domcontentloaded" });
  await page.close();

  // Returning to the form keeps the same pending token and still creates no Customer.
  const resumedToken = await preRegister(request, abandonedEmail);
  expect(resumedToken).toBe(abandonedToken);
  const resumedAttempt = await createSetupIntent(request, resumedToken);
  expect(resumedAttempt.setupIntentId).toBe(firstAttempt.setupIntentId);
  expect(await stripeCustomers(abandonedEmail)).toHaveLength(0);
  expect(await accountState(abandonedEmail)).toEqual({ users: [], orgs: [] });

  const unauthenticatedDashboardRequest = await request.get(`${BASE_URL}/api/me`);
  expect([401, 403]).toContain(unauthenticatedDashboardRequest.status());

  // A confirmed SetupIntent alone must not create an account or start its trial.
  const setupEmail = uniqueEmail("setup-only");
  const setupToken = await preRegister(request, setupEmail);
  const setup = await createSetupIntent(request, setupToken);
  const confirmedSetup = await stripe.setupIntents.confirm(setup.setupIntentId, {
    payment_method: "pm_card_visa",
  });
  expect(confirmedSetup.status).toBe("succeeded");
  const setupEvent = await findStripeEvent("setup_intent.succeeded", confirmedSetup.id);
  const setupDelivery = await deliverStripeEvent(request, setupEvent);
  expect(setupDelivery.status()).toBe(200);
  expect(await accountState(setupEmail)).toEqual({ users: [], orgs: [] });
  expect(await stripeCustomers(setupEmail)).toHaveLength(0);

  // Simulate a declined payment using Stripe's official TEST card fixture.
  const declinedEmail = uniqueEmail("declined");
  const declinedToken = await preRegister(request, declinedEmail);
  let declinedIntent;
  try {
    declinedIntent = await stripe.paymentIntents.create({
      amount: 100,
      currency: "eur",
      payment_method_types: ["card"],
      payment_method: "pm_card_chargeDeclined",
      confirm: true,
      metadata: {
        pre_register_token: declinedToken,
        orgId: declinedEmail,
        org_id: declinedEmail,
        plan: "standard",
      },
    });
  } catch (error) {
    const paymentIntentId =
      error?.raw?.payment_intent?.id ??
      (typeof error?.raw?.payment_intent === "string" ? error.raw.payment_intent : null);
    if (paymentIntentId) declinedIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  }
  if (!declinedIntent) {
    const intents = await stripe.paymentIntents.list({ limit: 100 });
    declinedIntent = intents.data.find((intent) => intent.metadata.pre_register_token === declinedToken);
  }
  expect(declinedIntent).toBeTruthy();
  expect(declinedIntent.status).not.toBe("succeeded");
  const declinedFinalize = await post(request, "/api/public/finalize-checkout", {
    intentId: declinedIntent.id,
    intentType: "payment",
    plan: "standard",
    addons: {},
    preRegisterToken: declinedToken,
  });
  expect(declinedFinalize.status()).toBe(400);
  expect(await stripeCustomers(declinedEmail)).toHaveLength(0);
  expect(await accountState(declinedEmail)).toEqual({ users: [], orgs: [] });

  // A real, successful Stripe TEST payment can recover even if the browser never
  // reaches finalize-checkout. No catalog price/product is created or changed.
  const paidEmail = setupEmail;
  const paidToken = setupToken;
  const paidIntent = await stripe.paymentIntents.create({
    amount: 100,
    currency: "eur",
    payment_method_types: ["card"],
    payment_method: "pm_card_visa",
    confirm: true,
    setup_future_usage: "off_session",
    metadata: {
      pre_register_token: paidToken,
      orgId: paidEmail,
      org_id: paidEmail,
      plan: "standard",
      trial_days_remaining: "14",
      addons: "{}",
    },
  });
  expect(paidIntent.status).toBe("succeeded");
  expect(await stripeCustomers(paidEmail)).toHaveLength(0);

  const paidEvent = await findStripeEvent("payment_intent.succeeded", paidIntent.id);
  const paidDelivery = await deliverStripeEvent(request, paidEvent);
  expect(paidDelivery.status()).toBe(200);

  const activated = await accountState(paidEmail);
  expect(activated.users).toHaveLength(1);
  expect(activated.users[0].status).toBe("active");
  expect(activated.orgs).toHaveLength(1);
  expect(activated.orgs[0].subscription_status).toBe("trialing");
  const trialDays = (new Date(activated.orgs[0].trial_ends_at).getTime() - Date.now()) / 86_400_000;
  expect(trialDays).toBeGreaterThan(13.9);
  expect(trialDays).toBeLessThanOrEqual(14.1);
  expect(activated.orgs[0].stripe_subscription_id).toBeTruthy();
  const createdSubscription = await stripe.subscriptions.retrieve(activated.orgs[0].stripe_subscription_id);
  expect(createdSubscription.status).toBe("trialing");
  expect(createdSubscription.items.data.some((item) => item.price.id === STANDARD_TEST_PRICE_ID)).toBe(true);
  const subscriptionTrialDays = (createdSubscription.trial_end * 1000 - Date.now()) / 86_400_000;
  expect(subscriptionTrialDays).toBeGreaterThan(13.9);
  expect(subscriptionTrialDays).toBeLessThanOrEqual(14.1);
  const subscriptions = await stripe.subscriptions.list({
    customer: activated.orgs[0].stripe_customer_id,
    status: "all",
    limit: 100,
  });
  expect(subscriptions.data).toHaveLength(1);

  const createdCustomers = await stripeCustomers(paidEmail);
  expect(createdCustomers).toHaveLength(1);
  expect(createdCustomers[0].metadata.pre_register_token).toBe(paidToken);

  // Replaying the actual Stripe event is idempotent: no second account or Customer.
  const duplicateDelivery = await deliverStripeEvent(request, paidEvent);
  expect(duplicateDelivery.status()).toBe(200);
  expect((await duplicateDelivery.json()).duplicate).toBe(true);
  expect(await stripeCustomers(paidEmail)).toHaveLength(1);
  expect((await stripe.subscriptions.list({
    customer: activated.orgs[0].stripe_customer_id,
    status: "all",
    limit: 100,
  })).data).toHaveLength(1);
  expect(await accountState(paidEmail)).toEqual(activated);
});

test.afterAll(async () => {
  await pool.end();
});
