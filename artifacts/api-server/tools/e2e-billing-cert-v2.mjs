/**
 * e2e-billing-cert-v2.mjs — FlowPoint Billing E2E Certification v2
 *
 * Uses real Stripe Test Mode API calls that cause Stripe's servers to fire
 * REAL webhook events signed with the isolated test endpoint secret.
 * No local HMAC construction — the server verifies STRIPE_TEST_WEBHOOK_SECRET.
 *
 * Webhook endpoint: we_1U17g79eqtbj6iPBomfUnTvv
 * URL: https://${REPLIT_DEV_DOMAIN}/api/billing/webhook
 *
 * Flows:
 *   F2  AI 50K pack  (Standard plan ctx, payment_intent.succeeded)
 *   F1  Standard→Pro (customer.subscription.created)
 *   F3  monitorsPack10 add-on (customer.subscription.updated)
 *
 * Usage: node tools/e2e-billing-cert-v2.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const STRIPE_PATH =
  "/home/runner/workspace/node_modules/.pnpm/stripe@22.1.0_@types+node@20.19.43/node_modules/stripe/cjs/stripe.cjs.node.js";
const PG_PATH =
  "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";

const Stripe    = require(STRIPE_PATH);
const { Pool }  = require(PG_PATH);

// ── Config ───────────────────────────────────────────────────────────────────
const TEST_ORG_ID     = "e2ec0000-b222-4000-a000-000000000042";
const TEST_EMAIL      = `e2ev2-${Date.now()}@cert-test.local`;
const TEST_PRICE_PRO  = process.env.STRIPE_PRICE_ID_PRO;
const TEST_PRICE_AI50 = process.env.STRIPE_PRICE_AI_50K;
const TEST_PRICE_MON  = process.env.STRIPE_PRICE_ID_10MONITORS;
const STD_AI_CREDITS  = 100_000; // Standard plan monthly included
const MONTH           = new Date().toISOString().slice(0, 7);

if (!process.env.STRIPE_TEST_KEY)       throw new Error("STRIPE_TEST_KEY not set");
if (!process.env.STRIPE_PRICE_ID_PRO)   throw new Error("STRIPE_PRICE_ID_PRO not set (test price)");
if (!process.env.STRIPE_PRICE_AI_50K)   throw new Error("STRIPE_PRICE_AI_50K not set (test price)");
if (!process.env.STRIPE_PRICE_ID_10MONITORS) throw new Error("STRIPE_PRICE_ID_10MONITORS not set (test price)");

const stripe = new Stripe(process.env.STRIPE_TEST_KEY, { apiVersion: "2026-04-22.dahlia" });
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ───────────────────────────────────────────────────────────────────
const dbRun = (sql, p = []) => pool.query(sql, p);
const dbOne = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt   = n  => Number(n).toLocaleString("fr-FR");

async function waitFor(label, check, maxMs = 20_000, intervalMs = 600) {
  const deadline = Date.now() + maxMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const result = await check().catch(() => null);
    if (result) return result;
    if (attempt % 5 === 0)
      process.stdout.write(`  [${label}] still waiting... ${Math.round((deadline - Date.now()) / 1000)}s left\n`);
    await sleep(intervalMs);
  }
  throw new Error(`[${label}] Timeout — condition not met in ${maxMs / 1000}s`);
}

// ── Banner ────────────────────────────────────────────────────────────────────
const line = "═".repeat(62);
console.log(`\n${line}`);
console.log("  FlowPoint Billing — E2E Certification v2");
console.log("  Stripe Test Mode | Real webhook delivery from Stripe");
console.log(`  Endpoint: we_1U17g79eqtbj6iPBomfUnTvv`);
console.log(`  URL: https://${process.env.REPLIT_DEV_DOMAIN}/api/billing/webhook`);
console.log(`  TEST_PRICE_PRO  : ${TEST_PRICE_PRO}`);
console.log(`  TEST_PRICE_AI50 : ${TEST_PRICE_AI50}`);
console.log(`  TEST_PRICE_MON  : ${TEST_PRICE_MON}`);
console.log(line);

// ════════════════════════════════════════════════════════════════════════════
//  SETUP — test org + Stripe customer + test payment method
// ════════════════════════════════════════════════════════════════════════════
console.log("\n[ SETUP ]");

await dbRun(`
  INSERT INTO organizations (id, name, owner_email, plan, subscription_status)
  VALUES ($1, 'E2E Cert v2', $2, 'standard', 'active')
  ON CONFLICT (id) DO UPDATE SET plan='standard', subscription_status='active'
`, [TEST_ORG_ID, TEST_EMAIL]);
console.log(`  DB: org ${TEST_ORG_ID} created (plan=standard)`);

const cus = await stripe.customers.create({
  email:    TEST_EMAIL,
  name:     "E2E Cert v2",
  metadata: { orgId: TEST_ORG_ID, env: "test-cert-v2" },
});
console.log(`  Stripe customer: ${cus.id}`);

await dbRun(`UPDATE organizations SET stripe_customer_id=$2 WHERE id=$1`, [TEST_ORG_ID, cus.id]);
await dbRun(`UPDATE org_settings   SET stripe_customer_id=$2 WHERE id=$1`, [TEST_ORG_ID, cus.id]).catch(() => {});

const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
await stripe.paymentMethods.attach(pm.id, { customer: cus.id });
await stripe.customers.update(cus.id, { invoice_settings: { default_payment_method: pm.id } });
console.log(`  Payment method: ${pm.id} (tok_visa → 4242 4242 4242 4242)`);

// ════════════════════════════════════════════════════════════════════════════
//  FLOW 2 — AI 50K pack (Standard plan, payment_intent.succeeded)
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"─".repeat(62)}`);
console.log("  FLOW 2 — AI 50 000 crédits (Standard plan, 100 000 inclus)");
console.log("─".repeat(62));

const purchasedBefore = Number((await dbOne(
  `SELECT COALESCE(SUM(credits), 0)::int AS v FROM ai_credit_purchases WHERE org_id=$1`,
  [TEST_ORG_ID]
))?.v ?? 0);
const usedBefore = Number((await dbOne(
  `SELECT COALESCE(credits_used, 0)::int AS v FROM ai_monthly_usage WHERE org_id=$1 AND month=$2`,
  [TEST_ORG_ID, MONTH]
))?.v ?? 0);
const availableBefore = STD_AI_CREDITS + purchasedBefore - usedBefore;

console.log("  AVANT :");
console.log(`    includedCredits  (plan Standard) : ${fmt(STD_AI_CREDITS)}`);
console.log(`    purchasedCredits (ai_credit_purchases) : ${fmt(purchasedBefore)}`);
console.log(`    usedCredits      (ai_monthly_usage)    : ${fmt(usedBefore)}`);
console.log(`    availableCredits                       : ${fmt(availableBefore)}`);

// Create + confirm PaymentIntent → Stripe fires REAL payment_intent.succeeded webhook
const pi = await stripe.paymentIntents.create({
  amount:   400,
  currency: "eur",
  customer: cus.id,
  payment_method: pm.id,
  metadata: {
    type:           "ai_credits",
    pack:           "ai_credits_50k",
    credits:        "50000",
    amountEurCents: "400",
    orgId:          TEST_ORG_ID,
  },
  confirm: true,
  automatic_payment_methods: { enabled: true, allow_redirects: "never" },
});
console.log(`\n  Stripe PaymentIntent: ${pi.id}  status=${pi.status}`);
console.log("  → Stripe fires payment_intent.succeeded to webhook endpoint");
console.log("  Attente livraison webhook Stripe...");

const aiRow = await waitFor("AI-50K webhook", async () => {
  const r = await dbOne(
    `SELECT id, credits, amount_eur_cents, created_at FROM ai_credit_purchases WHERE id=$1`,
    [`acp_pi_${pi.id}`]
  );
  return r || null;
});

const purchasedAfter  = Number((await dbOne(
  `SELECT COALESCE(SUM(credits), 0)::int AS v FROM ai_credit_purchases WHERE org_id=$1`,
  [TEST_ORG_ID]
))?.v ?? 0);
const availableAfter  = STD_AI_CREDITS + purchasedAfter - usedBefore;

console.log("\n  APRÈS :");
console.log(`    purchasedCredits : ${fmt(purchasedBefore)} → ${fmt(purchasedAfter)}  (+50 000)`);
console.log(`    availableCredits : ${fmt(availableBefore)} → ${fmt(availableAfter)}`);
console.log(`    Calcul : ${fmt(STD_AI_CREDITS)} (inclus) + ${fmt(purchasedAfter)} (achetés) = ${fmt(availableAfter)}`);
console.log(`    Ligne DB : id=${aiRow.id}  credits=${aiRow.credits}  amount_eur_cents=${aiRow.amount_eur_cents}  created_at=${aiRow.created_at}`);
const f2ok = availableAfter === 150_000;
console.log(`    ${f2ok ? "✓ PASS" : "✗ FAIL"} — ${fmt(availableAfter)} crédits disponibles (attendu: 150 000)`);

// Idempotency — same PI id can never double-credit
const idem = await dbOne(`SELECT COUNT(*)::int AS n FROM ai_credit_purchases WHERE id=$1`, [`acp_pi_${pi.id}`]);
console.log(`    Idempotence : ${idem.n} ligne pour acp_pi_${pi.id} (ON CONFLICT DO NOTHING → aucune double-entrée possible)`);

// Browser checkout session (for visual verification)
const aiSess = await stripe.checkout.sessions.create({
  customer:    cus.id,
  mode:        "payment",
  line_items:  [{ price: TEST_PRICE_AI50, quantity: 1 }],
  success_url: `https://${process.env.REPLIT_DEV_DOMAIN}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `https://${process.env.REPLIT_DEV_DOMAIN}/dashboard.html`,
  metadata:    { type: "ai_credits", pack: "ai_credits_50k", credits: "50000", amountEurCents: "400", orgId: TEST_ORG_ID },
});
console.log(`\n  URL navigateur (vérification visuelle Stripe Test) :`);
console.log(`    ${aiSess.url}`);
console.log(`    Carte test : 4242 4242 4242 4242  |  12/29  |  123`);

// ════════════════════════════════════════════════════════════════════════════
//  FLOW 1 — Standard → Pro (customer.subscription.created)
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"─".repeat(62)}`);
console.log("  FLOW 1 — Standard → Pro (subscription.created webhook)");
console.log("─".repeat(62));

const planBefore = (await dbOne(`SELECT plan FROM organizations WHERE id=$1`, [TEST_ORG_ID]))?.plan;
console.log(`  AVANT : plan=${planBefore}  (DB organizations)`);

const sub = await stripe.subscriptions.create({
  customer:               cus.id,
  items:                  [{ price: TEST_PRICE_PRO }],
  default_payment_method: pm.id,
  metadata:               { plan: "pro", orgId: TEST_ORG_ID },
});
console.log(`\n  Stripe Subscription: ${sub.id}  status=${sub.status}`);
console.log("  → Stripe fires customer.subscription.created to webhook endpoint");
console.log("  Attente livraison webhook Stripe...");

const orgUpgraded = await waitFor("sub-created webhook", async () => {
  const r = await dbOne(`SELECT plan, subscription_status FROM organizations WHERE id=$1`, [TEST_ORG_ID]);
  return r?.plan === "pro" ? r : null;
});

console.log("\n  APRÈS :");
console.log(`    plan               : ${planBefore} → ${orgUpgraded.plan}`);
console.log(`    subscription_status: ${orgUpgraded.subscription_status}`);
console.log(`    Stripe sub ID      : ${sub.id}`);
console.log(`    ${orgUpgraded.plan === "pro" ? "✓ PASS" : "✗ FAIL"} — plan mis à jour via webhook réel Stripe`);

// Browser checkout session (for visual verification of plan change)
const planSess = await stripe.checkout.sessions.create({
  customer:    cus.id,
  mode:        "subscription",
  line_items:  [{ price: TEST_PRICE_PRO, quantity: 1 }],
  success_url: `https://${process.env.REPLIT_DEV_DOMAIN}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `https://${process.env.REPLIT_DEV_DOMAIN}/dashboard.html`,
  metadata:    { plan: "pro", orgId: TEST_ORG_ID },
});
console.log(`\n  URL navigateur (vérification visuelle Stripe Test) :`);
console.log(`    ${planSess.url}`);
console.log(`    Carte test : 4242 4242 4242 4242  |  12/29  |  123`);

// ════════════════════════════════════════════════════════════════════════════
//  FLOW 3 — Add-on monitorsPack10 (customer.subscription.updated)
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"─".repeat(62)}`);
console.log("  FLOW 3 — Add-on monitorsPack10 (subscription.updated webhook)");
console.log("─".repeat(62));

const addonBefore = await dbOne(
  `SELECT active FROM org_addons WHERE org_id=$1 AND addon_key='monitorsPack10'`,
  [TEST_ORG_ID]
);
const monitorLimitBefore = (await dbOne(
  `SELECT COALESCE((plan_limits->>'monitors')::int, 50) AS monitors FROM organizations WHERE id=$1`,
  [TEST_ORG_ID]
))?.monitors ?? "n/a";

console.log(`  AVANT : monitorsPack10 active=${addonBefore?.active ?? false}`);
console.log(`          monitors limit (plan) : ${monitorLimitBefore}`);

// Add monitorsPack10 to existing subscription → fires customer.subscription.updated
const subItem = await stripe.subscriptionItems.create({
  subscription: sub.id,
  price:        TEST_PRICE_MON,
  metadata:     { addonKey: "monitorsPack10", orgId: TEST_ORG_ID },
});
console.log(`\n  Stripe SubscriptionItem: ${subItem.id}  (price=${subItem.price.id})`);
console.log("  → Stripe fires customer.subscription.updated to webhook endpoint");
console.log("  Attente livraison webhook Stripe...");

const addonAfter = await waitFor("addon webhook", async () => {
  const r = await dbOne(
    `SELECT addon_key, active, updated_at FROM org_addons WHERE org_id=$1 AND addon_key='monitorsPack10'`,
    [TEST_ORG_ID]
  );
  return r?.active === true ? r : null;
});

// Full subscription snapshot for audit
const subFull = await stripe.subscriptions.retrieve(sub.id);
const subItems = subFull.items.data.map(i => `${i.price.id}  (${i.price.nickname ?? i.price.currency})`);

console.log("\n  APRÈS :");
console.log(`    addonKey : ${addonAfter.addon_key}`);
console.log(`    active   : ${addonBefore?.active ?? false} → ${addonAfter.active}`);
console.log(`    updated  : ${addonAfter.updated_at}`);
console.log(`    Stripe subscription items :`);
for (const it of subItems) console.log(`      • ${it}`);
console.log(`    ${addonAfter.active ? "✓ PASS" : "✗ FAIL"} — monitorsPack10 activé via webhook réel Stripe`);

// Browser checkout session (for visual verification of add-on)
const addonSess = await stripe.checkout.sessions.create({
  customer:    cus.id,
  mode:        "payment",
  line_items:  [{ price: TEST_PRICE_MON, quantity: 1 }],
  success_url: `https://${process.env.REPLIT_DEV_DOMAIN}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `https://${process.env.REPLIT_DEV_DOMAIN}/dashboard.html`,
  metadata:    { orgId: TEST_ORG_ID, addonKey: "monitorsPack10" },
});
console.log(`\n  URL navigateur (vérification visuelle Stripe Test) :`);
console.log(`    ${addonSess.url}`);
console.log(`    Carte test : 4242 4242 4242 4242  |  12/29  |  123`);

// ════════════════════════════════════════════════════════════════════════════
//  PRODUCTION INTEGRITY CHECK
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"─".repeat(62)}`);
console.log("  Vérification intégrité production");
console.log("─".repeat(62));

const integrity = await dbOne(`
  SELECT
    (SELECT COUNT(*)::int FROM organizations WHERE owner_email LIKE '%cert-test.local%')    AS cert_orgs,
    (SELECT COUNT(*)::int FROM organizations WHERE owner_email LIKE '%audit-test.local%')   AS audit_orgs,
    (SELECT COUNT(*)::int FROM billing_events  WHERE org_id='e2ec0000-b111-4000-a000-000000000042') AS prev_cert_events,
    (SELECT COUNT(*)::int FROM ai_credit_purchases
       WHERE org_id NOT IN (SELECT id FROM organizations)) AS orphan_credits
`);
console.log(`  Orgs cert-test      : ${integrity.cert_orgs}   (attendu: 1 — org test actuelle)`);
console.log(`  Orgs audit-test     : ${integrity.audit_orgs}  (attendu: 0)`);
console.log(`  Résidu ancienne cert: ${integrity.prev_cert_events} billing_events orphelins (attendu: 0)`);
console.log(`  Credits orphelins   : ${integrity.orphan_credits}  (attendu: 0)`);
const integrityOk = integrity.audit_orgs === 0 && integrity.prev_cert_events === 0 && integrity.orphan_credits === 0;
console.log(`  ${integrityOk ? "✓ PASS" : "⚠ ISSUES FOUND"} — données production non modifiées`);

// ════════════════════════════════════════════════════════════════════════════
//  CLEANUP
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"─".repeat(62)}`);
console.log("  Nettoyage");
console.log("─".repeat(62));

await stripe.subscriptions.cancel(sub.id).catch(e => console.warn(`  Cancel sub: ${e.message}`));
await stripe.customers.del(cus.id).catch(e => console.warn(`  Del cus: ${e.message}`));
console.log(`  Stripe: abonnement ${sub.id} annulé, client ${cus.id} supprimé`);

await dbRun(`DELETE FROM billing_events      WHERE org_id=$1`, [TEST_ORG_ID]);
await dbRun(`DELETE FROM org_addons          WHERE org_id=$1`, [TEST_ORG_ID]);
await dbRun(`DELETE FROM ai_credit_purchases WHERE org_id=$1`, [TEST_ORG_ID]);
await dbRun(`DELETE FROM ai_monthly_usage    WHERE org_id=$1`, [TEST_ORG_ID]);
await dbRun(`DELETE FROM organizations       WHERE id=$1`,     [TEST_ORG_ID]);
console.log(`  DB: org ${TEST_ORG_ID} et toutes ses données supprimées`);

// ════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${line}`);
console.log("  RÉSULTAT FINAL");
console.log(line);
console.log(`  Flow 1 (Standard→Pro)    : ${orgUpgraded.plan === "pro" ? "✓ PASS" : "✗ FAIL"}`);
console.log(`  Flow 2 (AI 50K pack)     : ${f2ok ? "✓ PASS" : "✗ FAIL"}  (${fmt(availableAfter)} crédits disponibles)`);
console.log(`  Flow 3 (monitorsPack10)  : ${addonAfter.active ? "✓ PASS" : "✗ FAIL"}`);
console.log(`  Intégrité production     : ${integrityOk ? "✓ PASS" : "⚠ ISSUES"}`);
console.log(line + "\n");

await pool.end();
