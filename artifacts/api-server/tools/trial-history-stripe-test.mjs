import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { isFirstTimeTrialEligible } from "../src/services/trial-history.ts";

const key = process.env.STRIPE_TEST_KEY;
if (!key || !key.startsWith("sk_test_")) {
  throw new Error("This certification requires STRIPE_TEST_KEY; live keys are refused.");
}

const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
const suffix = randomUUID();
const created = { productId: null, priceId: null, customerIds: [], subscriptionId: null };
const testProductName = "FlowPoint synthetic trial-history certification";

try {
  // Archive only products created by this certification on earlier runs. The
  // exact name + metadata guard prevents touching unrelated Stripe TEST data.
  const previousProducts = await stripe.products.search({
    query: `name:'${testProductName}' AND metadata['purpose']:'trial-history-test'`,
    limit: 100,
  });
  for (const previousProduct of previousProducts.data) {
    const activePrices = await stripe.prices.list({
      product: previousProduct.id,
      active: true,
      limit: 100,
    });
    for (const previousPrice of activePrices.data) {
      await stripe.prices.update(previousPrice.id, { active: false });
    }
    await stripe.products.update(previousProduct.id, { active: false });
  }

  const product = await stripe.products.create({
    name: testProductName,
    metadata: { purpose: "trial-history-test", environment: "test" },
  });
  created.productId = product.id;

  const price = await stripe.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: 100,
    recurring: { interval: "month" },
    metadata: { purpose: "trial-history-test", environment: "test" },
  });
  created.priceId = price.id;

  const newCustomer = await stripe.customers.create({
    email: `trial-new-${suffix}@example.test`,
    metadata: { purpose: "trial-history-test", environment: "test" },
  });
  created.customerIds.push(newCustomer.id);

  assert.equal(
    await isFirstTimeTrialEligible(stripe, {
      accountHasHistory: false,
      customerIds: [newCustomer.id],
      email: newCustomer.email,
    }),
    true,
    "a synthetic new customer should qualify",
  );

  const returningCustomer = await stripe.customers.create({
    email: `trial-returning-${suffix}@example.test`,
    metadata: { purpose: "trial-history-test", environment: "test" },
  });
  created.customerIds.push(returningCustomer.id);

  const subscription = await stripe.subscriptions.create({
    customer: returningCustomer.id,
    items: [{ price: price.id }],
    trial_period_days: 14,
    metadata: { purpose: "trial-history-test", environment: "test" },
  });
  created.subscriptionId = subscription.id;

  assert.equal(
    await isFirstTimeTrialEligible(stripe, {
      accountHasHistory: false,
      customerIds: [returningCustomer.id],
      email: returningCustomer.email,
    }),
    false,
    "a synthetic customer with a trial subscription should not qualify again",
  );

  await stripe.subscriptions.cancel(subscription.id);
  assert.equal(
    await isFirstTimeTrialEligible(stripe, {
      accountHasHistory: false,
      email: returningCustomer.email,
    }),
    false,
    "a canceled subscription found by email must still block another trial",
  );

  console.log("Stripe TEST trial-history certification passed: new customer eligible; returning customer blocked.");
} finally {
  const cleanupFailures = [];
  if (created.subscriptionId) {
    const canceled = await stripe.subscriptions.cancel(created.subscriptionId).catch(() => null);
    if (canceled && canceled.status !== "canceled") cleanupFailures.push("subscription");
  }
  for (const customerId of created.customerIds) {
    const deleted = await stripe.customers.del(customerId).catch(() => null);
    if (!deleted?.deleted) cleanupFailures.push("customer");
  }
  if (created.priceId) {
    const archived = await stripe.prices.update(created.priceId, { active: false }).catch(() => null);
    if (archived?.active !== false) cleanupFailures.push("price");
  }
  if (created.productId) {
    const archived = await stripe.products.update(created.productId, { active: false }).catch(() => null);
    if (archived?.active !== false) cleanupFailures.push("product");
  }
  if (cleanupFailures.length > 0) {
    console.error(`Stripe TEST cleanup incomplete for: ${[...new Set(cleanupFailures)].join(", ")}.`);
    process.exitCode = 1;
  } else {
    console.log("Synthetic Stripe TEST customers were deleted, the subscription was canceled, and test catalog objects were archived.");
  }
}
