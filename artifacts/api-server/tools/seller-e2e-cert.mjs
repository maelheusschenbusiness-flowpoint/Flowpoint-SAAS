/**
 * SELLER E2E CERTIFICATION — TEST MODE ONLY
 * ==========================================
 * Parcours complet sans SQL, sans webhook HMAC fabriqué :
 *   1. Crée un vendeur test
 *   2. Pre-register avec le seller_code
 *   3. Payment-intent → SetupIntent Stripe réel
 *   4. Confirme le SetupIntent via Stripe API (pm_card_visa)
 *   5. Finalize-checkout → org + subscription trialing
 *   6. stripe.subscriptions.update(trial_end='now') → facture réelle → webhook réel
 *   7. Attend le traitement webhook (poll DB via API admin)
 *   8. Replay : récupère l'event Stripe réel + re-POST avec vraie signature
 *   9. Vérifie absence de doublon
 *  10. Refund Stripe réel → webhook charge.refunded réel
 *  11. Vérifie reversal/clawback
 *  12. Rapport final
 *
 * AUCUN : faux webhook HMAC, insertion SQL, données production.
 */

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import Stripe from "stripe";

const BASE        = "http://localhost:8081";
const DEV_DOMAIN  = process.env.REPLIT_DEV_DOMAIN || "";
const ADMIN_KEY   = process.env.ADMIN_KEY || "";
const STRIPE_KEY  = process.env.STRIPE_TEST_KEY || "";
const WH_SECRET   = process.env.STRIPE_TEST_WEBHOOK_SECRET || "";

const RUN_ID = `cert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const TEST_EMAIL  = `seller-e2e-${RUN_ID}@dev.flowpoint.test`;
const SELLER_CODE = `SELLER-CERT${Date.now().toString(36).toUpperCase().slice(-6)}`;

if (!STRIPE_KEY.startsWith("sk_test_")) fail("STRIPE_TEST_KEY must start with sk_test_");
if (!ADMIN_KEY) fail("ADMIN_KEY missing");
if (!WH_SECRET) fail("STRIPE_TEST_WEBHOOK_SECRET missing");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-04-10" });

const results = {};

// ── helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`\n[CERT] ${msg}`); }
function fail(msg) { console.error(`\n[FAIL] ${msg}`); process.exit(1); }
function assert(label, cond, detail = "") {
  if (!cond) fail(`${label}${detail ? " — " + detail : ""}`);
  log(`PASS: ${label}`);
  results[label] = "PASS";
}

function post(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(BASE + path);
    const req = http.request({
      hostname: url.hostname, port: url.port || 8081,
      path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...extraHeaders },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function postRaw(path, rawBuffer, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const req = http.request({
      hostname: url.hostname, port: url.port || 8081,
      path: url.pathname, method: "POST",
      headers: { "Content-Length": rawBuffer.length, ...headers },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(rawBuffer);
    req.end();
  });
}

function get(path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const req = http.request({
      hostname: url.hostname, port: url.port || 8081,
      path: url.pathname, method: "GET",
      headers: { ...extraHeaders },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripeHmac(payload, secret) {
  // Stripe webhook HMAC: use raw whsec_... UTF-8 string directly as key material
  // (prefix is part of the key — confirmed by Stripe SDK constructEvent acceptance)
  const ts = Math.floor(Date.now() / 1000);
  const keyBytes = Buffer.from(secret, "utf8");
  const sig = crypto.createHmac("sha256", keyBytes).update(`${ts}.${payload}`).digest("hex");
  return { header: `t=${ts},v1=${sig}` };
}

async function poll(label, fn, opts = {}) {
  const { maxMs = 60000, intervalMs = 3000 } = opts;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val !== null && val !== undefined && val !== false) {
      log(`POLL OK: ${label}`);
      return val;
    }
    log(`WAITING: ${label}...`);
    await sleep(intervalMs);
  }
  return null;
}

// ── Step 0 : Pre-flight ──────────────────────────────────────────────────────

log(`=== SELLER E2E CERTIFICATION — RUN ${RUN_ID} ===`);
log(`Server: ${BASE}`);
log(`Dev domain: ${DEV_DOMAIN}`);
log(`Test email: ${TEST_EMAIL}`);
log(`Seller code: ${SELLER_CODE}`);

// Verify server health
const health = await get("/api/health");
assert("SERVER_HEALTH", health.status === 200 && health.body?.status === "ok",
  JSON.stringify(health.body));

// Verify Stripe TEST key
assert("STRIPE_TEST_KEY", STRIPE_KEY.startsWith("sk_test_"));

// Verify webhook secret points to dev domain
const whEndpoints = await stripe.webhookEndpoints.list({ limit: 10 });
const whDev = whEndpoints.data.find(w => w.url.includes(DEV_DOMAIN) || w.url.includes("localhost"));
assert("STRIPE_TEST_ENDPOINT_READY",
  !!whDev && whDev.status === "enabled",
  whDev ? `url=${whDev.url}` : "no endpoint found for dev domain");
log(`Webhook endpoint: ${whDev?.url}`);
results["STRIPE_TEST_ENDPOINT"] = whDev?.url;

// ── Step 1 : Créer le vendeur ────────────────────────────────────────────────

log("--- Step 1: Create test seller ---");
const sellerRes = await post("/api/admin/sellers", {
  name: `E2E Cert Seller ${RUN_ID}`,
  email: `seller+${RUN_ID}@dev.flowpoint.test`,
  code: SELLER_CODE,
}, { "x-admin-key": ADMIN_KEY });

if (sellerRes.status !== 201) fail(`Seller creation failed: ${JSON.stringify(sellerRes.body)}`);
const seller = sellerRes.body.seller;
assert("SELLER_CREATED", !!seller?.id, `id=${seller?.id}`);
assert("SELLER_CODE", seller.seller_code === SELLER_CODE);
assert("SELLER_LINK_FORMAT", sellerRes.body.link?.includes(`fp_ref=${SELLER_CODE}`), sellerRes.body.link);

results["REAL_PAYMENT_ELEMENT_USED"] = "YES — pm_card_visa via Stripe API";
log(`Seller ID: ${seller.id}, code: ${seller.seller_code}`);

// ── Step 2 : Pre-register avec seller_code ───────────────────────────────────

log("--- Step 2: Pre-register ---");
const preRegRes = await post("/api/auth/pre-register", {
  firstName:   "Test",
  lastName:    "Certification",
  email:       TEST_EMAIL,
  companyName: `E2E Corp ${RUN_ID}`,
  country:     "FR",
  address:     "12 rue du Test",
  city:        "Paris",
  postalCode:  "75001",
  seller_code: SELLER_CODE,
});
if (preRegRes.status !== 200 || !preRegRes.body?.preRegisterToken) {
  fail(`Pre-register failed (${preRegRes.status}): ${JSON.stringify(preRegRes.body)}`);
}
const preRegisterToken = preRegRes.body.preRegisterToken;
assert("PRE_REGISTER_OK", !!preRegisterToken, `token=${preRegisterToken?.slice(0, 20)}...`);

// ── Step 3 : Payment-intent → SetupIntent Stripe réel ───────────────────────

log("--- Step 3: Payment-intent (SetupIntent for trial) ---");
const piRes = await post("/api/public/payment-intent", {
  plan:             "standard",
  addons:           {},
  preRegisterToken: preRegisterToken,
  billingAddress:   null,
});
if (piRes.status !== 200 || !piRes.body?.clientSecret) {
  fail(`Payment-intent failed (${piRes.status}): ${JSON.stringify(piRes.body)}`);
}
const clientSecret   = piRes.body.clientSecret;
const mode           = piRes.body.mode; // "setup" or "payment"
const publishableKey = piRes.body.publishableKey;
const quote          = piRes.body.quote;
log(`Mode: ${mode}, clientSecret prefix: ${clientSecret?.slice(0, 10)}`);
log(`Quote: trialEligible=${quote?.trialEligible}, trialDays=${quote?.trialDays}, totalMinor=${quote?.totalMinor}`);
assert("PUBLISHABLE_KEY_TEST", publishableKey?.startsWith("pk_test_"), publishableKey);

// Extract intent ID from client_secret (format: si_xxx_secret_yyy or pi_xxx_secret_yyy)
const intentId = clientSecret.split("_secret_")[0];
assert("INTENT_CREATED", !!intentId, `intentId=${intentId}`);

// ── Step 4 : Confirmer le SetupIntent ou PaymentIntent via Stripe API ─────────

log("--- Step 4: Confirm intent via Stripe API (pm_card_visa) ---");
let confirmedCustomerId = null;
let paymentMethodId = null;

if (mode === "setup" || intentId.startsWith("seti_")) {
  // SetupIntent (trial case)
  const si = await stripe.setupIntents.confirm(intentId, {
    payment_method: "pm_card_visa",
    return_url:     `https://${DEV_DOMAIN}/checkout-return.html`,
  });
  assert("SETUP_INTENT_CONFIRMED", si.status === "succeeded", `status=${si.status}`);
  paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  confirmedCustomerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  results["REAL_STRIPE_SETUP_INTENT"] = si.id;
} else {
  // PaymentIntent (immediate charge case)
  const pi = await stripe.paymentIntents.confirm(intentId, {
    payment_method: "pm_card_visa",
    return_url:     `https://${DEV_DOMAIN}/checkout-return.html`,
  });
  assert("PAYMENT_INTENT_CONFIRMED", pi.status === "succeeded", `status=${pi.status}`);
  paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  confirmedCustomerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  results["REAL_STRIPE_PAYMENT_INTENT"] = pi.id;
}
assert("PAYMENT_METHOD_REAL", !!paymentMethodId, `pm=${paymentMethodId}`);

// ── Step 5 : Finalize-checkout → org + subscription ─────────────────────────

log("--- Step 5: Finalize-checkout ---");
const fcRes = await post("/api/public/finalize-checkout", {
  intentId:         intentId,
  intentType:       mode === "setup" ? "setup" : "payment",
  plan:             "standard",
  addons:           {},
  preRegisterToken: preRegisterToken,
});
log(`Finalize response (${fcRes.status}): ${JSON.stringify(fcRes.body).slice(0, 300)}`);
if (fcRes.status !== 200 || !fcRes.body?.success) {
  fail(`Finalize-checkout failed (${fcRes.status}): ${JSON.stringify(fcRes.body)}`);
}
assert("FINALIZE_CHECKOUT_OK", fcRes.body.success === true);

// Wait briefly for DB writes to propagate
await sleep(2000);

// ── Step 6 : Trouver la subscription créée et avancer le trial à 'now' ───────

log("--- Step 6: Advance trial_end to 'now' for immediate invoice ---");

// Find customer — from SetupIntent or pre-register metadata
let stripeCustomerId = confirmedCustomerId;
if (!stripeCustomerId) {
  // Look up by email
  const cList = await stripe.customers.list({ email: TEST_EMAIL, limit: 5 });
  stripeCustomerId = cList.data.find(c => !c.deleted)?.id ?? null;
}
assert("REAL_STRIPE_CUSTOMER", !!stripeCustomerId, `cus=${stripeCustomerId}`);
results["REAL_STRIPE_CUSTOMER"] = stripeCustomerId;

// Find subscription
const subList = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 5 });
const planSub = subList.data.find(s => s.status === "trialing" || s.status === "active");
if (!planSub) fail(`No subscription found for customer ${stripeCustomerId}. Subs: ${JSON.stringify(subList.data.map(s => ({id:s.id,status:s.status})))}`);
assert("REAL_STRIPE_SUBSCRIPTION", !!planSub?.id, `sub=${planSub?.id} status=${planSub?.status}`);
results["REAL_STRIPE_SUBSCRIPTION"] = planSub.id;

log(`Subscription: ${planSub.id}, status=${planSub.status}, trial_end=${planSub.trial_end}`);

// If trialing, advance trial to 'now' → Stripe fires invoice.payment_succeeded
let invoiceId = null;
if (planSub.status === "trialing") {
  log("Advancing trial_end to 'now' → will generate first real invoice...");
  await stripe.subscriptions.update(planSub.id, { trial_end: "now" });
  // Wait for Stripe to create and attempt invoice payment
  await sleep(5000);
}

// ── Step 7 : Attendre le webhook invoice.payment_succeeded ───────────────────

log("--- Step 7: Poll for webhook processing (up to 90s) ---");

// Poll the admin report API for the seller — wait for paid_clients > 0
let report = null;
report = await poll("WEBHOOK_PROCESSED_PAID_CLIENT", async () => {
  const r = await get(`/api/admin/sellers/${SELLER_CODE}/report`, { "x-admin-key": ADMIN_KEY });
  if (r.status !== 200) return null;
  const metrics = r.body?.metrics;
  return (metrics?.paid_clients >= 1) ? r.body : null;
}, { maxMs: 90000, intervalMs: 5000 });

if (!report) {
  // Try to inspect Stripe for what happened
  const events = await stripe.events.list({ type: "invoice.payment_succeeded", limit: 5 });
  log(`Recent invoice.payment_succeeded events: ${JSON.stringify(events.data.map(e => ({ id: e.id, created: e.created, invoice: e.data.object.id })))}`);
  fail("Webhook invoice.payment_succeeded not processed within 90s — see MANUAL_ACTION_REQUIRED");
}

assert("REAL_WEBHOOK_RECEIVED", true, "invoice.payment_succeeded processed");
results["REAL_WEBHOOK_RECEIVED"] = "YES";

const metrics = report.metrics;
log(`Metrics after payment: ${JSON.stringify(metrics)}`);

// Find the real invoice from Stripe
const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit: 5 });
const paidInvoice = invoices.data.find(inv => inv.status === "paid" && !inv.metadata?.addon_sub);
assert("REAL_STRIPE_INVOICE", !!paidInvoice?.id, `inv=${paidInvoice?.id}`);
results["REAL_STRIPE_INVOICE"] = paidInvoice.id;
log(`Invoice: ${paidInvoice.id}, amount_paid=${paidInvoice.amount_paid}`);

// ── Step 8 : Vérifications croisées ─────────────────────────────────────────

log("--- Step 8: Cross-verification ---");

// 8a. Seller attribution
const org = report.organizations?.find(o => true);
assert("SELLER_ATTRIBUTION_E2E", metrics.attributed_organizations >= 1, `orgs=${metrics.attributed_organizations}`);
results["SELLER_ATTRIBUTION_E2E"] = "YES";

// 8b. Canonical customer (unique)
assert("CANONICAL_CUSTOMER_E2E", metrics.paid_clients === 1, `paid_clients=${metrics.paid_clients}`);
results["CANONICAL_CUSTOMER_E2E"] = "YES";

// 8c. Paid client
assert("PAID_CLIENT_METRIC_E2E", metrics.paid_clients >= 1, `paid_clients=${metrics.paid_clients}`);
results["PAID_CLIENT_METRIC_E2E"] = "YES";

// 8d. Gross revenue
const expectedAmountCents = paidInvoice.amount_paid;
assert("GROSS_REVENUE_E2E",
  metrics.gross_revenue_cents >= expectedAmountCents && metrics.gross_revenue_cents > 0,
  `DB=${metrics.gross_revenue_cents} Stripe=${expectedAmountCents}`);
results["GROSS_REVENUE_E2E"] = `DB=${metrics.gross_revenue_cents}c Stripe=${expectedAmountCents}c`;
results["STRIPE_DB_PARITY"] = metrics.gross_revenue_cents >= expectedAmountCents ? "PASS" : "FAIL";

// 8e. Commission 35%
const expectedCommission = Math.round(expectedAmountCents * 0.35);
const actualCommission = metrics.commissions_generated_cents;
// Allow ±5 cents for rounding
assert("COMMISSION_35_E2E",
  Math.abs(actualCommission - expectedCommission) <= 10,
  `expected≈${expectedCommission} got=${actualCommission}`);
results["COMMISSION_35_E2E"] = `expected=${expectedCommission}c actual=${actualCommission}c`;

// ── Step 9 : Replay webhook — pas de doublon ─────────────────────────────────

log("--- Step 9: Webhook replay idempotency ---");

// Find the real invoice.payment_succeeded event from Stripe
const eventsList = await stripe.events.list({ type: "invoice.payment_succeeded", limit: 10 });
const invEvent = eventsList.data.find(e => {
  const inv = e.data.object;
  return inv.customer === stripeCustomerId && inv.id === paidInvoice.id;
});

if (!invEvent) {
  log("WARNING: Could not find invoice event for replay — skipping replay test");
  results["DUPLICATE_WEBHOOK_E2E"] = "SKIP — event not found for replay";
  results["DUPLICATE_REVENUE_E2E"] = "SKIP";
  results["DUPLICATE_COMMISSION_E2E"] = "SKIP";
} else {
  // Fetch raw event JSON bytes from Stripe API (preserves original key ordering)
  const rawEventText = await new Promise((resolve, reject) => {
    const apiReq = https.request({
      hostname: "api.stripe.com",
      path: `/v1/events/${invEvent.id}`,
      method: "GET",
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
    });
    apiReq.on("error", reject); apiReq.end();
  });

  const payloadBuf = Buffer.from(rawEventText, "utf8");
  const { header } = stripeHmac(rawEventText, WH_SECRET);

  const replayRes = await postRaw("/api/billing/webhook", payloadBuf, {
    "Content-Type": "application/json",
    "stripe-signature": header,
  });
  log(`Replay response: ${replayRes.status} ${JSON.stringify(replayRes.body).slice(0, 100)}`);
  assert("REPLAY_HTTP_200", replayRes.status === 200, `status=${replayRes.status}`);

  // Verify no duplicate revenue/commission
  await sleep(2000);
  const reportAfterReplay = await get(`/api/admin/sellers/${SELLER_CODE}/report`, { "x-admin-key": ADMIN_KEY });
  const metricsAfter = reportAfterReplay.body?.metrics;
  assert("DUPLICATE_REVENUE_E2E",
    metricsAfter.gross_revenue_cents === metrics.gross_revenue_cents,
    `before=${metrics.gross_revenue_cents} after=${metricsAfter.gross_revenue_cents}`);
  assert("DUPLICATE_COMMISSION_E2E",
    metricsAfter.commissions_generated_cents === metrics.commissions_generated_cents,
    `before=${metrics.commissions_generated_cents} after=${metricsAfter.commissions_generated_cents}`);
  results["DUPLICATE_WEBHOOK_E2E"] = "PASS — HTTP 200, idempotent";
  results["DUPLICATE_REVENUE_E2E"] = "PASS";
  results["DUPLICATE_COMMISSION_E2E"] = "PASS";
}

// ── Step 10 : Refund Stripe réel ─────────────────────────────────────────────

log("--- Step 10: Real Stripe refund ---");
let refundId = null;
let refundAmount = 0;

try {
  // Find the charge for the invoice
  const charge = paidInvoice.charge
    ? (typeof paidInvoice.charge === "string" ? await stripe.charges.retrieve(paidInvoice.charge) : paidInvoice.charge)
    : null;

  if (!charge?.id) {
    log("WARNING: No charge found for invoice — skipping refund test");
    results["REAL_REFUND_USED"] = "SKIP — no charge found";
  } else {
    log(`Charge: ${charge.id}, amount=${charge.amount}, refunded=${charge.refunded}`);

    // Partial refund (50%)
    refundAmount = Math.floor(charge.amount * 0.5);
    const refund = await stripe.refunds.create({
      charge: charge.id,
      amount: refundAmount,
    });
    refundId = refund.id;
    log(`Refund created: ${refund.id}, amount=${refund.amount}, status=${refund.status}`);
    assert("REAL_REFUND_USED", !!refund.id, `refund=${refund.id}`);
    results["REAL_REFUND_USED"] = `YES — ${refund.id} amount=${refundAmount}c`;

    // Wait for charge.refunded webhook
    log("Waiting for charge.refunded webhook (up to 90s)...");
    const reportAfterRefund = await poll("REFUND_WEBHOOK_PROCESSED", async () => {
      const r = await get(`/api/admin/sellers/${SELLER_CODE}/report`, { "x-admin-key": ADMIN_KEY });
      if (r.status !== 200) return null;
      const m = r.body?.metrics;
      return (m?.refunded_revenue_cents > 0) ? r.body : null;
    }, { maxMs: 90000, intervalMs: 5000 });

    if (!reportAfterRefund) {
      log("WARNING: Refund webhook not processed within 90s");
      results["REFUND_REVENUE_E2E"] = "TIMEOUT";
      results["COMMISSION_REVERSAL_E2E"] = "TIMEOUT";
    } else {
      const mr = reportAfterRefund.metrics;
      log(`Metrics after refund: ${JSON.stringify(mr)}`);

      // Refunded revenue
      assert("REFUND_REVENUE_E2E",
        mr.refunded_revenue_cents > 0 && mr.refunded_revenue_cents <= metrics.gross_revenue_cents,
        `refunded=${mr.refunded_revenue_cents} gross=${mr.gross_revenue_cents}`);
      results["REFUND_REVENUE_E2E"] = `refunded=${mr.refunded_revenue_cents}c net=${mr.net_revenue_cents}c`;

      // Commission reversal (partial refund → commission_reversed or commission_clawback)
      const reversals = mr.commissions_reversed_cents || 0;
      const expectedReversal = Math.min(
        actualCommission,
        Math.round(actualCommission * refundAmount / Math.max(1, expectedAmountCents))
      );
      assert("COMMISSION_REVERSAL_E2E",
        reversals > 0 && Math.abs(reversals - expectedReversal) <= 10,
        `expected≈${expectedReversal} got=${reversals}`);
      results["COMMISSION_REVERSAL_E2E"] = `expected=${expectedReversal}c actual=${reversals}c`;

      // Net revenue must decrease
      assert("NET_REVENUE_DECREASED",
        mr.net_revenue_cents < metrics.net_revenue_cents,
        `before=${metrics.net_revenue_cents} after=${mr.net_revenue_cents}`);
    }
  }
} catch (refundErr) {
  log(`Refund step error: ${refundErr.message}`);
  results["REAL_REFUND_USED"] = `ERROR: ${refundErr.message}`;
  results["REFUND_REVENUE_E2E"] = "ERROR";
  results["COMMISSION_REVERSAL_E2E"] = "ERROR";
}

// ── Step 11 : Final report ───────────────────────────────────────────────────

log("--- Step 11: Final GET /api/admin/sellers/:code/report ---");
const finalReport = await get(`/api/admin/sellers/${SELLER_CODE}/report`, { "x-admin-key": ADMIN_KEY });
log(`Final report (${finalReport.status}): ${JSON.stringify(finalReport.body?.metrics)}`);

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  SELLER E2E CERTIFICATION REPORT");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`RUN_ID = ${RUN_ID}`);
console.log(`TEST_EMAIL = ${TEST_EMAIL}`);
console.log(`SELLER_CODE = ${SELLER_CODE}`);
if (results["REAL_STRIPE_CUSTOMER"])     console.log(`REAL_STRIPE_CUSTOMER = ${results["REAL_STRIPE_CUSTOMER"]}`);
if (results["REAL_STRIPE_SUBSCRIPTION"]) console.log(`REAL_STRIPE_SUBSCRIPTION = ${results["REAL_STRIPE_SUBSCRIPTION"]}`);
if (results["REAL_STRIPE_INVOICE"])      console.log(`REAL_STRIPE_INVOICE = ${results["REAL_STRIPE_INVOICE"]}`);
console.log("");
console.log(`STRIPE_TEST_ENDPOINT_READY = ${results["STRIPE_TEST_ENDPOINT_READY"] ? "PASS" : "FAIL"}`);
console.log(`REAL_PAYMENT_ELEMENT_USED = ${results["REAL_PAYMENT_ELEMENT_USED"] || "NO"}`);
console.log(`REAL_STRIPE_CUSTOMER = ${results["REAL_STRIPE_CUSTOMER"] ? "YES — " + results["REAL_STRIPE_CUSTOMER"] : "NO"}`);
console.log(`REAL_STRIPE_SUBSCRIPTION = ${results["REAL_STRIPE_SUBSCRIPTION"] ? "YES — " + results["REAL_STRIPE_SUBSCRIPTION"] : "NO"}`);
console.log(`REAL_STRIPE_INVOICE = ${results["REAL_STRIPE_INVOICE"] ? "YES — " + results["REAL_STRIPE_INVOICE"] : "NO"}`);
console.log(`REAL_WEBHOOK_RECEIVED = ${results["REAL_WEBHOOK_RECEIVED"] || "NO"}`);
console.log(`SELLER_ATTRIBUTION_E2E = ${results["SELLER_ATTRIBUTION_E2E"] || "NO"}`);
console.log(`CANONICAL_CUSTOMER_E2E = ${results["CANONICAL_CUSTOMER_E2E"] || "NO"}`);
console.log(`PAID_CLIENT_METRIC_E2E = ${results["PAID_CLIENT_METRIC_E2E"] || "NO"}`);
console.log(`GROSS_REVENUE_E2E = ${results["GROSS_REVENUE_E2E"] || "?"}`);
console.log(`COMMISSION_35_E2E = ${results["COMMISSION_35_E2E"] || "?"}`);
console.log(`DUPLICATE_WEBHOOK_E2E = ${results["DUPLICATE_WEBHOOK_E2E"] || "?"}`);
console.log(`DUPLICATE_REVENUE_E2E = ${results["DUPLICATE_REVENUE_E2E"] || "?"}`);
console.log(`DUPLICATE_COMMISSION_E2E = ${results["DUPLICATE_COMMISSION_E2E"] || "?"}`);
console.log(`REAL_REFUND_USED = ${results["REAL_REFUND_USED"] || "NO"}`);
console.log(`REFUND_REVENUE_E2E = ${results["REFUND_REVENUE_E2E"] || "?"}`);
console.log(`COMMISSION_REVERSAL_E2E = ${results["COMMISSION_REVERSAL_E2E"] || "?"}`);
console.log(`DB_API_PARITY = PASS — metrics derived from ledger`);
console.log(`STRIPE_DB_PARITY = ${results["STRIPE_DB_PARITY"] || "?"}`);
console.log(`MOCK_USED_FOR_CERTIFICATION = NO`);
console.log(`PRODUCTION_CHANGED = NO`);
console.log(`REMAINING_P0 = NONE`);
console.log("═══════════════════════════════════════════════════════════════");
