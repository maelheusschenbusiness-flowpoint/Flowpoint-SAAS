/**
 * deletion-cert-stripe.mjs — Stripe side of the account-deletion certification.
 *
 * Proves that deleting an account:
 *   • cancels every live subscription,
 *   • deletes the Stripe customer,
 *   • and STILL retains the historical invoice / payment record, which is a
 *     legal retention requirement and must survive the deletion.
 *
 * Runs entirely in Stripe TEST mode against a throwaway server instance so the
 * live Stripe account is never touched.
 *
 * Usage: STRIPE_TEST_MODE=true node tools/deletion-cert-stripe.mjs
 *        (expects a server started with STRIPE_TEST_MODE=true on CERT_BASE_URL)
 */
import { createRequire } from "module";
import { randomUUID, randomBytes } from "crypto";
import { writeFileSync } from "fs";

const require = createRequire(import.meta.url);
const STRIPE_PATH = "/home/runner/workspace/node_modules/.pnpm/stripe@22.1.0_@types+node@20.19.43/node_modules/stripe/cjs/stripe.cjs.node.js";
const PG_PATH     = "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";
const Stripe   = require(STRIPE_PATH);
const { Pool } = require(PG_PATH);

const BASE = process.env.CERT_BASE_URL || "http://127.0.0.1:8092";
if (!process.env.STRIPE_TEST_KEY?.startsWith("sk_test_")) {
  throw new Error("STRIPE_TEST_KEY (sk_test_...) is required — refusing to run against live Stripe.");
}
const stripe = new Stripe(process.env.STRIPE_TEST_KEY, { apiVersion: "2026-04-22.dahlia" });
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

const RUN   = Date.now();
const ORG   = randomUUID(), USER = randomUUID();
const TOKEN = randomBytes(32).toString("hex");
const EMAIL = `stripe-cert-${RUN}@deletion-cert.local`;

let pass = 0, fail = 0;
const notes = [];
const ok = (label, v, detail = "") => {
  console.log(`${v ? "✅" : "❌"} ${label}${detail ? ` · ${detail}` : ""}`);
  v ? pass++ : fail++;
  if (!v) notes.push(`${label} — ${detail}`);
};

(async () => {
  let customerId = null, subId = null, invoiceId = null;
  try {
    console.log("\n── Building a real Stripe test-mode customer with a live subscription\n");

    const product = await stripe.products.create({ name: `Deletion Cert ${RUN}` });
    const price   = await stripe.prices.create({
      product: product.id, unit_amount: 4900, currency: "eur", recurring: { interval: "month" },
    });

    const customer = await stripe.customers.create({
      email: EMAIL, name: "Deletion Cert",
      metadata: { orgId: ORG, purpose: "account-deletion-certification" },
    });
    customerId = customer.id;

    // pm_card_visa is not enabled on every test account; build the PM from the
    // universally available tok_visa test token instead.
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
    await stripe.paymentMethods.attach(pm.id, { customer: customerId });
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });

    const sub = await stripe.subscriptions.create({
      customer: customerId, items: [{ price: price.id }],
      default_payment_method: pm.id,
    });
    subId = sub.id;
    ok("Stripe test subscription is live before deletion", sub.status === "active" || sub.status === "trialing", sub.status);

    const invoices = await stripe.invoices.list({ customer: customerId, limit: 1 });
    invoiceId = invoices.data[0]?.id ?? null;
    ok("An invoice exists before deletion (financial record)", !!invoiceId, invoiceId || "none");

    // ── Wire the customer into a real FlowPoint org ──────────────────────────
    await pool.query(`INSERT INTO users(id,email,status,email_verified) VALUES($1,$2,'active',true)`, [USER, EMAIL]);
    await pool.query(
      `INSERT INTO organizations(id,name,slug,owner_user_id,status,plan,subscription_status,owner_email,stripe_customer_id,stripe_subscription_id)
       VALUES($1,$2,$3,$4,'active','pro','active',$5,$6,$7)`,
      [ORG, `Stripe Cert ${RUN}`, `stripe-cert-${RUN}`, USER, EMAIL, customerId, subId]);
    await pool.query(`INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [ORG, USER]);
    await pool.query(
      `INSERT INTO user_sessions(token,user_id,org_id,email,role,expires_at,user_id_v2)
       VALUES($1,$2,$3,$4,'owner',NOW()+INTERVAL '1 hour',$5)`, [TOKEN, USER, ORG, EMAIL, USER]);

    // ── Delete the account ───────────────────────────────────────────────────
    console.log("\n── Deleting the account\n");
    const res  = await fetch(`${BASE}/api/billing/account`, {
      method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    console.log(`  HTTP ${res.status} ${JSON.stringify(body)}\n`);
    ok("Deletion endpoint returns 200", res.status === 200, `HTTP ${res.status}`);
    ok("Report says the Stripe customer was deleted", body?.deleted?.stripeCustomer === true, JSON.stringify(body?.deleted));
    ok("Report counts the canceled subscription", Number(body?.deleted?.subscriptionsCanceled) >= 1, String(body?.deleted?.subscriptionsCanceled));

    // ── Resurrection probe: did the org row ever actually disappear? ────────
    console.log("── Polling organizations row for 8s (resurrection probe)\n");
    const obs = [];
    for (let i = 0; i < 16; i++) {
      const r = await pool.query(
        `SELECT COUNT(*)::int n, MAX(updated_at) upd FROM organizations WHERE id::text=$1`, [ORG]);
      obs.push(`${i * 500}ms:${r.rows[0].n}`);
      await new Promise(z => setTimeout(z, 500));
    }
    console.log("  " + obs.join(" ") + "\n");
    ok("Org row disappeared at some point after deletion", obs.some(o => o.endsWith(":0")), obs.join(" "));

    // ── Verify against Stripe itself ─────────────────────────────────────────
    console.log("── Verifying directly against Stripe\n");

    const subAfter = await stripe.subscriptions.retrieve(subId).catch(() => null);
    ok("Subscription is canceled at Stripe", subAfter === null || subAfter.status === "canceled",
       subAfter ? subAfter.status : "not retrievable");

    const custAfter = await stripe.customers.retrieve(customerId).catch(e => ({ _err: e.code }));
    const custDeleted = custAfter?.deleted === true || custAfter?._err === "resource_missing";
    ok("Customer is deleted at Stripe", custDeleted, JSON.stringify(custAfter?.deleted ?? custAfter?._err));

    // The legal requirement: the invoice must SURVIVE.
    const invAfter = invoiceId ? await stripe.invoices.retrieve(invoiceId).catch(e => ({ _err: e.code })) : null;
    ok("Invoice is RETAINED after deletion (legal record preserved)",
       !!invAfter && !invAfter._err && invAfter.id === invoiceId,
       invAfter?._err ? `error ${invAfter._err}` : `invoice ${invAfter?.id} status=${invAfter?.status}`);

    // ── DB must be clean ─────────────────────────────────────────────────────
    const dbAfter = await pool.query(
      `SELECT (SELECT COUNT(*) FROM organizations WHERE id::text=$1) o,
              (SELECT COUNT(*) FROM users WHERE id::text=$2) u,
              (SELECT COUNT(*) FROM user_sessions WHERE org_id::text=$1) s`, [ORG, USER]);
    const d = dbAfter.rows[0];
    ok("Org, user and session removed from database", Number(d.o) + Number(d.u) + Number(d.s) === 0, JSON.stringify(d));

    writeFileSync(new URL("./deletion-cert-stripe-report.json", import.meta.url), JSON.stringify({
      certifiedAt: new Date().toISOString(),
      mode: "stripe_test_mode",
      orgId: ORG, customerId, subscriptionId: subId, invoiceId,
      httpStatus: res.status, httpBody: body,
      subscriptionStatusAfter: subAfter?.status ?? "deleted",
      customerDeleted: custDeleted,
      invoiceRetained: !!invAfter && !invAfter._err,
      databaseClean: Number(d.o) + Number(d.u) + Number(d.s) === 0,
      result: { pass, fail, notes },
    }, null, 2));

  } catch (e) {
    console.error("FATAL", e);
    fail++;
  } finally {
    // Safety net: never leave a live test subscription or org behind.
    if (subId)      await stripe.subscriptions.cancel(subId).catch(() => {});
    if (customerId) await stripe.customers.del(customerId).catch(() => {});
    await pool.query(`DELETE FROM user_sessions WHERE org_id::text=$1`, [ORG]).catch(() => {});
    await pool.query(`DELETE FROM organization_members WHERE organization_id::text=$1`, [ORG]).catch(() => {});
    await pool.query(`DELETE FROM organizations WHERE id::text=$1`, [ORG]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id::text=$1`, [USER]).catch(() => {});
    await pool.end();
    console.log(`\n═══ Stripe deletion cert: ${pass} passed, ${fail} failed ═══`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
