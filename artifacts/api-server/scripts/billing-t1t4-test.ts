/**
 * billing-t1t4-test.ts — Tests T1–T4 end-to-end contre l'API live
 *
 * T1  Free → Standard   : crée un Customer + Subscription Stripe (trial 7j)
 * T2  Standard → Pro    : appelle POST /api/billing/upgrade plan=pro
 * T3  Pro → Ultra       : appelle POST /api/billing/upgrade plan=ultra
 * T4  Ultra → Standard  : appelle POST /api/billing/upgrade plan=standard
 *
 * À chaque étape on vérifie que le Customer ID Stripe est IDENTIQUE.
 *
 * Usage:
 *   pnpm --filter api-server exec tsx scripts/billing-t1t4-test.ts
 */

import Stripe from "stripe";
import { pool } from "@workspace/db";
import { createSession } from "../src/services/sessions.js";

const SEP   = "═".repeat(72);
const BASE  = "http://localhost:8081";
const KEY   = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";

// ── Price IDs (live, from lib/plans.ts) ──────────────────────────────────────
const PRICE_IDS: Record<string, string> = {
  standard: process.env["STRIPE_PRICE_ID_STANDARD"] ?? "price_1StVzQ9eqtbj6iPBNOLjgwHm",
  pro:      process.env["STRIPE_PRICE_ID_PRO"]      ?? "price_1StW0A9eqtbj6iPB8GcUCuwQ",
  ultra:    process.env["STRIPE_PRICE_ID_ULTRA"]    ?? "price_1StW109eqtbj6iPBgiD1uRtP",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = (msg: string) => { console.log(`  ✅  ${msg}`); return true; };
const FAIL = (msg: string) => { console.log(`  ❌  ${msg}`); return false; };

async function apiUpgrade(plan: string, cookie: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/billing/upgrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ plan }),
  });
  return r.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function dbCustomerId(orgId: string): Promise<string | null> {
  const c = await pool.connect();
  try {
    const r = await c.query<{ cid: string | null }>(
      `SELECT COALESCE(NULLIF(o.stripe_customer_id,''), NULLIF(os.stripe_customer_id,'')) AS cid
       FROM org_settings os LEFT JOIN organizations o ON o.id = os.org_id
       WHERE os.org_id = $1 LIMIT 1`,
      [orgId]
    );
    return r.rows[0]?.cid ?? null;
  } finally { c.release(); }
}

async function dbSubId(orgId: string): Promise<string | null> {
  const c = await pool.connect();
  try {
    const r = await c.query<{ sid: string | null }>(
      `SELECT stripe_subscription_id AS sid FROM org_settings WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    return r.rows[0]?.sid ?? null;
  } finally { c.release(); }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!KEY) { console.error("❌  STRIPE_LIVE_API_KEY manquant"); process.exit(1); }

  const stripe     = new Stripe(KEY, { apiVersion: "2025-06-30.basil" as Parameters<typeof Stripe>[1]["apiVersion"] });
  const keyLabel   = KEY.startsWith("sk_live_") ? "LIVE 🔴" : "TEST 🟡";
  const RUN_ID     = Date.now();
  const TEST_EMAIL = `t1t4-${RUN_ID}@flowpoint-test.invalid`;
  const TEST_ORG   = `test-t1t4-${RUN_ID}`;

  console.log(`\n${SEP}`);
  console.log(`FlowPoint — Tests T1–T4  (${new Date().toISOString().slice(0,19)})`);
  console.log(`Stripe key: ${keyLabel}   |   org: ${TEST_ORG}`);
  console.log(`${SEP}\n`);

  let createdCustomerId: string | null = null;
  let createdSubId:      string | null = null;
  let allPassed = true;

  // ────────────────────────────────────────────────────────────────────────────
  // T1 — Free → Standard : 1 Customer, 1 Subscription
  // ────────────────────────────────────────────────────────────────────────────
  console.log("T1  Free → Standard");

  // 1a. Create Stripe customer
  const customer = await stripe.customers.create({
    email: TEST_EMAIL,
    description: `FlowPoint T1-T4 test ${RUN_ID}`,
    metadata: { orgId: TEST_ORG, flowpointOrgId: TEST_ORG, test: "true" },
  });
  createdCustomerId = customer.id;
  console.log(`    Customer créé      : ${createdCustomerId}`);

  // 1b. Create trial subscription on "standard" (7-day trial, no card required)
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: PRICE_IDS.standard }],
    trial_period_days: 7,
    metadata: { orgId: TEST_ORG, plan: "standard", test: "true" },
  });
  createdSubId = subscription.id;
  console.log(`    Subscription créé  : ${createdSubId}  (status: ${subscription.status})`);

  // 1c. Write to DB (org_settings + organizations)
  const dbClient = await pool.connect();
  try {
    await dbClient.query(
      `INSERT INTO org_settings
         (org_id, email, subscription_status, plan, stripe_customer_id, stripe_subscription_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id) DO UPDATE
         SET subscription_status = EXCLUDED.subscription_status,
             plan = EXCLUDED.plan,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             stripe_subscription_id = EXCLUDED.stripe_subscription_id`,
      [TEST_ORG, TEST_EMAIL, "trialing", "standard", customer.id, subscription.id]
    );
    await dbClient.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, stripe_customer_id)
       VALUES ($1,$2,$3,$4,'active',$5,$6)
       ON CONFLICT (id) DO UPDATE
         SET plan               = EXCLUDED.plan,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             updated_at         = NOW()`,
      [TEST_ORG, `Test Org ${RUN_ID}`, `test-${RUN_ID}`, TEST_ORG, "standard", customer.id]
    );
  } finally { dbClient.release(); }
  console.log(`    DB mis à jour      : org_id = ${TEST_ORG}`);

  // 1d. Verify DB
  const t1Cid = await dbCustomerId(TEST_ORG);
  if (t1Cid === createdCustomerId) {
    PASS(`T1 — Customer correct en DB : ${t1Cid}`);
  } else {
    allPassed = false;
    FAIL(`T1 — Customer en DB ne correspond pas : DB=${t1Cid}, créé=${createdCustomerId}`);
  }

  // Create session cookie for subsequent API calls
  const sessionToken = await createSession({
    userId: TEST_ORG,
    orgId:  TEST_ORG,
    email:  TEST_EMAIL,
    role:   "owner",
  });
  const cookie = `fp_token=${sessionToken}`;

  const referenceCustomerId = createdCustomerId;

  // ────────────────────────────────────────────────────────────────────────────
  // T2 — Standard → Pro
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\nT2  Standard → Pro");
  const t2Res = await apiUpgrade("pro", cookie);
  console.log(`    API response       : ${JSON.stringify(t2Res).substring(0, 120)}`);

  const t2Cid = await dbCustomerId(TEST_ORG);
  const t2Sub = await dbSubId(TEST_ORG);

  if (t2Res.upgraded || t2Res.downgrade) {
    if (t2Cid === referenceCustomerId) {
      PASS(`T2 — Même Customer : ${t2Cid}`);
    } else {
      allPassed = false;
      FAIL(`T2 — Customer changé ! référence=${referenceCustomerId}, nouveau=${t2Cid}`);
    }
    console.log(`    Subscription       : ${t2Sub}`);
  } else {
    allPassed = false;
    FAIL(`T2 — Upgrade échoué : ${JSON.stringify(t2Res)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // T3 — Pro → Ultra
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\nT3  Pro → Ultra");
  const t3Res = await apiUpgrade("ultra", cookie);
  console.log(`    API response       : ${JSON.stringify(t3Res).substring(0, 120)}`);

  const t3Cid = await dbCustomerId(TEST_ORG);
  const t3Sub = await dbSubId(TEST_ORG);

  if (t3Res.upgraded || t3Res.downgrade) {
    if (t3Cid === referenceCustomerId) {
      PASS(`T3 — Même Customer : ${t3Cid}`);
    } else {
      allPassed = false;
      FAIL(`T3 — Customer changé ! référence=${referenceCustomerId}, nouveau=${t3Cid}`);
    }
    console.log(`    Subscription       : ${t3Sub}`);
  } else {
    allPassed = false;
    FAIL(`T3 — Upgrade échoué : ${JSON.stringify(t3Res)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // T4 — Ultra → Standard  (downgrade → scheduled at period end)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\nT4  Ultra → Standard  (downgrade)");
  const t4Res = await apiUpgrade("standard", cookie);
  console.log(`    API response       : ${JSON.stringify(t4Res).substring(0, 160)}`);

  const t4Cid = await dbCustomerId(TEST_ORG);

  if (t4Res.downgrade || t4Res.upgraded) {
    if (t4Cid === referenceCustomerId) {
      PASS(`T4 — Même Customer : ${t4Cid}`);
      if (t4Res.effective) console.log(`    Effectif le        : ${t4Res.effective}`);
    } else {
      allPassed = false;
      FAIL(`T4 — Customer changé ! référence=${referenceCustomerId}, nouveau=${t4Cid}`);
    }
  } else {
    allPassed = false;
    FAIL(`T4 — Downgrade échoué : ${JSON.stringify(t4Res)}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Récapitulatif Stripe (vérification finale)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n── Vérification Stripe finale ──────────────────────────────────────────");
  const finalSubs = await stripe.subscriptions.list({ customer: referenceCustomerId, status: "all", limit: 5 });
  const allCusts = await stripe.customers.list({ email: TEST_EMAIL, limit: 10 });

  console.log(`    Customers Stripe pour ${TEST_EMAIL} : ${allCusts.data.length}`);
  allCusts.data.forEach(c => console.log(`      - ${c.id}  (${c.email ?? "—"})`));
  console.log(`    Subscriptions sur ${referenceCustomerId} :`);
  finalSubs.data.forEach(s => console.log(`      - ${s.id}  status=${s.status}  plan=${s.metadata?.["plan"] ?? "?"}`));

  if (allCusts.data.length === 1) {
    PASS("Stripe Health — 1 seul Customer pour cet email ✓");
  } else {
    allPassed = false;
    FAIL(`Stripe Health — ${allCusts.data.length} Customers détectés pour le même email !`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Nettoyage : annuler la subscription + supprimer les DB rows
  // (le Customer Stripe est conservé pour inspection manuelle)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n── Nettoyage ────────────────────────────────────────────────────────────");
  try {
    // Annuler toutes les subscriptions du customer test
    const activeSubs = await stripe.subscriptions.list({ customer: referenceCustomerId, status: "all", limit: 10 });
    for (const s of activeSubs.data) {
      if (s.status !== "canceled") {
        await stripe.subscriptions.cancel(s.id);
        console.log(`    Subscription annulée : ${s.id}`);
      }
    }
  } catch (e) { console.warn(`    Avertissement nettoyage Stripe : ${e}`); }

  const cleanDb = await pool.connect();
  try {
    await cleanDb.query(`DELETE FROM org_settings  WHERE org_id = $1`, [TEST_ORG]);
    await cleanDb.query(`DELETE FROM organizations WHERE id = $1`,     [TEST_ORG]);
    await cleanDb.query(`DELETE FROM user_sessions  WHERE org_id = $1`, [TEST_ORG]);
    console.log(`    DB test org supprimée : ${TEST_ORG}`);
    console.log(`    Customer Stripe conservé pour inspection : ${referenceCustomerId}`);
  } finally { cleanDb.release(); }

  // ────────────────────────────────────────────────────────────────────────────
  // Résultat final
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`\n${SEP}`);
  if (allPassed) {
    console.log("RÉSULTAT : ✅  Tous les tests T1–T4 sont passés");
    console.log(`Customer de référence : ${referenceCustomerId}`);
  } else {
    console.log("RÉSULTAT : ❌  Certains tests ont échoué — voir détails ci-dessus");
  }
  console.log(`${SEP}\n`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
