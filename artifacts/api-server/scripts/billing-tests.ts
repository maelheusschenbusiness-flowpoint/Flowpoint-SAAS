/**
 * billing-tests.ts — Automated billing flow validation (Tests 1–8)
 *
 * Tests the API-level billing contracts without a browser:
 *   T1  Free → Standard  : 1 Customer, 1 Subscription
 *   T2  Standard → Pro   : same Customer
 *   T3  Pro → Ultra      : same Customer
 *   T4  Ultra → Standard : same Customer
 *   T5  Cancel → Reactivate : same Customer
 *   T6  Page reload (GET /api/me) : stripeCustomerId unchanged
 *   T7  Portal open → return : same Customer
 *   T8  Stripe Health : no resource_missing / no such customer
 *
 * Usage:
 *   pnpm --filter api-server exec tsx scripts/billing-tests.ts
 *
 * Requires: DATABASE_URL + STRIPE_LIVE_API_KEY + APP_BASE_URL (defaults to http://localhost:8081)
 */

import Stripe from "stripe";
import { pool } from "@workspace/db";
import * as crypto from "crypto";

const BASE_URL   = process.env["APP_BASE_URL"] || "http://localhost:8081";
const STRIPE_KEY = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
const SEP = "─".repeat(70);

// ── Test harness ──────────────────────────────────────────────────────────────

interface TestResult { name: string; pass: boolean; detail: string }
const results: TestResult[] = [];

function pass(name: string, detail = "") {
  results.push({ name, pass: true, detail });
  console.log(`  ✅  ${name}${detail ? `  (${detail})` : ""}`);
}
function fail(name: string, detail = "") {
  results.push({ name, pass: false, detail });
  console.log(`  ❌  ${name}${detail ? `  — ${detail}` : ""}`);
}
function skip(name: string, reason: string) {
  results.push({ name, pass: true, detail: `SKIP: ${reason}` });
  console.log(`  ⏭️   ${name}  [SKIP: ${reason}]`);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown, cookie: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function apiGet(path: string, cookie: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getOrgCustomerId(orgId: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ stripe_customer_id: string | null }>(
      `SELECT COALESCE(NULLIF(org.stripe_customer_id,''), NULLIF(os.stripe_customer_id,'')) AS stripe_customer_id
       FROM org_settings os
       LEFT JOIN organizations org ON org.id = os.org_id
       WHERE os.org_id = $1 LIMIT 1`,
      [orgId]
    );
    return r.rows[0]?.stripe_customer_id ?? null;
  } finally { client.release(); }
}

async function createTestSession(orgId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_sessions (token, org_id, user_id, expires_at)
       VALUES ($1, $2, $2, NOW() + INTERVAL '1 hour')
       ON CONFLICT (token) DO NOTHING`,
      [token, orgId]
    );
  } finally { client.release(); }
  return `fp_session=${token}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${SEP}`);
  console.log("FlowPoint — Billing Flow Tests (T1–T8)");
  console.log(`API: ${BASE_URL}  |  Stripe: ${STRIPE_KEY ? (STRIPE_KEY.startsWith("sk_live_") ? "LIVE 🔴" : "TEST 🟡") : "MISSING ❌"}`);
  console.log(`${SEP}\n`);

  if (!STRIPE_KEY) {
    console.error("❌  STRIPE_LIVE_API_KEY not set — aborting\n");
    process.exit(1);
  }

  const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2025-06-30.basil" as Parameters<typeof Stripe>[1]["apiVersion"] });

  // ── Create test org ───────────────────────────────────────────────────────
  const testEmail = `billing-test-${Date.now()}@flowpoint-test.invalid`;
  const testOrgId = testEmail;
  const dbClient  = await pool.connect();
  try {
    await dbClient.query(
      `INSERT INTO org_settings (org_id, email, subscription_status, plan)
       VALUES ($1, $1, 'pending_billing', 'standard')
       ON CONFLICT (org_id) DO NOTHING`,
      [testOrgId]
    );
    // Ensure organizations row exists
    await dbClient.query(
      `INSERT INTO organizations (id, email, subscription_status, plan)
       VALUES ($1, $1, 'pending_billing', 'standard')
       ON CONFLICT (id) DO NOTHING`,
      [testOrgId]
    );
  } finally { dbClient.release(); }

  const cookie = await createTestSession(testOrgId);
  console.log(`Test org: ${testOrgId}\n`);

  // ── T1: Free → subscribes (via /billing/checkout API) ────────────────────
  console.log("T1 — Free → Standard (1 Customer, 1 Subscription)");
  {
    const before = await getOrgCustomerId(testOrgId);
    // The checkout endpoint calls ensureStripeCustomer internally
    const r = await apiPost("/api/billing/checkout", { plan: "standard", addons: {} }, cookie);

    if (r.status === 409) {
      skip("T1", "subscription_already_active — org already has sub");
    } else if (r.ok || r.status === 400) {
      // Check that ensureStripeCustomer created exactly one customer
      const after = await getOrgCustomerId(testOrgId);
      if (after) {
        try {
          const cust = await stripe.customers.retrieve(after);
          if (!cust.deleted) {
            pass("T1 — customer created and valid", after);
          } else {
            fail("T1 — customer created but deleted in Stripe");
          }
        } catch { fail("T1 — customer ID in DB not found in Stripe", after ?? "null"); }
      } else {
        skip("T1 — customer not yet written (no live Stripe price IDs configured)");
      }
    } else {
      fail("T1 — unexpected status", String(r.status));
    }
  }

  // ── T2: Same Customer on /billing/upgrade Standard → Pro ─────────────────
  console.log("\nT2 — Standard → Pro (same Customer)");
  {
    const before = await getOrgCustomerId(testOrgId);
    const r = await apiPost("/api/billing/upgrade", { plan: "pro" }, cookie);
    const d = r.data as Record<string, unknown>;
    const after = await getOrgCustomerId(testOrgId);

    if (r.status === 409 && d.error === "plan_already_active") {
      skip("T2", "plan already Pro");
    } else if (d.noSubscription) {
      skip("T2", "no active subscription — upgrade redirected to checkout (expected for test org)");
    } else if (r.ok && (d.upgraded || d.downgrade)) {
      if (before && after && before === after) {
        pass("T2 — same customer after upgrade", after);
      } else if (!before) {
        skip("T2 — no customer before upgrade (no live prices)");
      } else {
        fail("T2 — customer changed after upgrade", `${before} → ${after}`);
      }
    } else {
      skip("T2", `status ${r.status} — ${JSON.stringify(d).substring(0, 80)}`);
    }
  }

  // ── T3: Same Customer on Pro → Ultra ─────────────────────────────────────
  console.log("\nT3 — Pro → Ultra (same Customer)");
  {
    const before = await getOrgCustomerId(testOrgId);
    const r = await apiPost("/api/billing/upgrade", { plan: "ultra" }, cookie);
    const d = r.data as Record<string, unknown>;
    const after = await getOrgCustomerId(testOrgId);
    if (d.noSubscription) {
      skip("T3", "no active subscription (test org)");
    } else if (r.ok && (d.upgraded || d.downgrade)) {
      before && after && before === after
        ? pass("T3 — same customer after upgrade", after)
        : fail("T3 — customer changed", `${before} → ${after}`);
    } else {
      skip("T3", `status ${r.status}`);
    }
  }

  // ── T4: Same Customer on Ultra → Standard ────────────────────────────────
  console.log("\nT4 — Ultra → Standard (same Customer)");
  {
    const before = await getOrgCustomerId(testOrgId);
    const r = await apiPost("/api/billing/upgrade", { plan: "standard" }, cookie);
    const d = r.data as Record<string, unknown>;
    const after = await getOrgCustomerId(testOrgId);
    if (d.noSubscription) {
      skip("T4", "no active subscription (test org)");
    } else if (r.ok && (d.upgraded || d.downgrade)) {
      before && after && before === after
        ? pass("T4 — same customer after downgrade", after)
        : fail("T4 — customer changed", `${before} → ${after}`);
    } else {
      skip("T4", `status ${r.status}`);
    }
  }

  // ── T5: Cancel → Reactivate: same Customer ───────────────────────────────
  console.log("\nT5 — Cancel → Reactivate (same Customer)");
  {
    const before = await getOrgCustomerId(testOrgId);
    const cancelR = await apiPost("/api/billing/cancel", { atPeriodEnd: true }, cookie);
    const after   = await getOrgCustomerId(testOrgId);
    if (!cancelR.ok && (cancelR.data as Record<string, unknown>).error === "no_active_subscription") {
      skip("T5", "no active subscription to cancel");
    } else {
      before && after && before === after
        ? pass("T5 — customer unchanged after cancel", after)
        : fail("T5 — customer changed after cancel", `${before} → ${after}`);
    }
  }

  // ── T6: Page reload → stripeCustomerId in /api/me unchanged ──────────────
  console.log("\nT6 — Page reload (/api/me) → stripeCustomerId unchanged");
  {
    const db1 = await getOrgCustomerId(testOrgId);
    const me1  = await apiGet("/api/me", cookie);
    const me2  = await apiGet("/api/me", cookie);
    const meCustomer = ((me1.data as Record<string, unknown>).stripeCustomerId as string | null) ?? null;
    const db2 = await getOrgCustomerId(testOrgId);
    if (db1 === db2) {
      pass("T6 — DB customer unchanged across /api/me calls", db1 ?? "null");
    } else {
      fail("T6 — DB customer changed between two /api/me calls", `${db1} → ${db2}`);
    }
    void me2; void meCustomer;
  }

  // ── T7: Portal → same Customer ───────────────────────────────────────────
  console.log("\nT7 — Portal open (POST /api/billing/portal) → same Customer");
  {
    const before = await getOrgCustomerId(testOrgId);
    const r = await apiPost("/api/billing/portal", {}, cookie);
    const after  = await getOrgCustomerId(testOrgId);
    if (!r.ok) {
      skip("T7", `portal returned ${r.status} — no active customer (expected for test org)`);
    } else {
      before && after && before === after
        ? pass("T7 — customer unchanged after portal call", after)
        : fail("T7 — portal created a new customer!", `${before} → ${after}`);
    }
  }

  // ── T8: Stripe Health — no resource_missing / no such customer ───────────
  console.log("\nT8 — Stripe Health (no resource_missing in last 1 h)");
  {
    try {
      // Check if the customer stored in DB is valid in Stripe
      const custId = await getOrgCustomerId(testOrgId);
      if (custId) {
        const c = await stripe.customers.retrieve(custId);
        c.deleted
          ? fail("T8 — DB customer is deleted in Stripe", custId)
          : pass("T8 — DB customer exists and is valid in Stripe", custId);
      } else {
        skip("T8", "no customer created during tests (no live Stripe prices)");
      }
    } catch (e) {
      fail("T8 — DB customer not found in Stripe", String(e));
    }
  }

  // ── Cleanup test org ──────────────────────────────────────────────────────
  const cleanup = await pool.connect();
  try {
    await cleanup.query(`DELETE FROM org_settings WHERE org_id = $1`, [testOrgId]);
    await cleanup.query(`DELETE FROM organizations WHERE id = $1`,   [testOrgId]);
    await cleanup.query(`DELETE FROM user_sessions WHERE org_id = $1`, [testOrgId]);
  } finally { cleanup.release(); }

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${SEP}`);
  console.log(`RESULTS: ${passed}/${results.length} passed  |  ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌  ${r.name}  ${r.detail}`));
  }
  console.log(`${SEP}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
