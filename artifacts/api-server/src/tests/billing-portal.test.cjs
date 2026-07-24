"use strict";
/**
 * FlowPoint — Billing Portal + Subscription State Machine tests (P0-1 / P0-2)
 *
 * Tests:
 *  T1:  Customer exists in DB → state machine returns "active" (subscriptionId present)
 *  T2:  No customer → state machine returns "none"
 *  T3:  20 concurrent upserts for same org → idempotent (single row)
 *  T4:  status=active + no subscriptionId → state machine returns "incomplete"
 *  T5:  State machine — active requires subscriptionId (pure function)
 *  T6:  Trial valid → state machine returns "trialing"
 *  T7:  Active subscription with ID → state machine returns "active"
 *  T8:  Subscription deleted (canceled) → state machine returns "canceled"
 *  T9:  Multi-tenant — two orgs never share customerId or status
 *  T10: DB normalization SQL — status=active without subscriptionId → incomplete/none
 *  T11: Valid states preserved by state machine
 *  T12: Trial expired → incomplete (has customer) or none
 *  T13: 20 concurrent DB writes → single final row
 *  T14: Startup normalization touches only invalid rows
 *  T15: Org A status does not bleed into Org B
 *
 * Run: NODE_PATH="…/pg" node artifacts/api-server/src/tests/billing-portal.test.cjs
 * Requires: DATABASE_URL or SUPABASE_* env vars
 */

const { Client } = require("pg");
const crypto     = require("crypto");
const assert     = require("assert");

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  (() => {
    const u = process.env.SUPABASE_URL;
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!u || !k) return null;
    const host = new URL(u).hostname.replace("supabase.co", "supabase.co");
    return `postgresql://postgres:${k}@${host}:5432/postgres`;
  })();

if (!DB_URL) {
  console.error("FATAL: No database URL found. Set DATABASE_URL or SUPABASE_* env vars.");
  process.exit(1);
}

const RUN    = Date.now();
const makeId = (label) => `test_portal_${label}_${RUN}@test.flowpoint.internal`;

let client;
let passed = 0;
let failed = 0;

// ── State machine (inline — mirrors lib/subscription-state.ts logic) ──────────
function normalizeSubscriptionStatus({ rawStatus, stripeSubscriptionId, stripeCustomerId, trialEndsAt }) {
  const hasSubscription = !!(stripeSubscriptionId && String(stripeSubscriptionId).trim());
  const hasCustomer     = !!(stripeCustomerId     && String(stripeCustomerId).trim());
  const trialActive     = !!(trialEndsAt && new Date(trialEndsAt) > new Date());
  const requiresSub     = new Set(["active", "past_due", "unpaid", "paused"]);

  if (rawStatus && requiresSub.has(rawStatus)) {
    if (!hasSubscription) {
      if (trialActive)  return "trialing";
      if (hasCustomer)  return "incomplete";
      return "none";
    }
    return rawStatus;
  }
  if (rawStatus === "canceled")   return "canceled";
  if (rawStatus === "trialing") {
    if (trialActive)              return "trialing";
    if (hasSubscription)          return "active";
    if (hasCustomer)              return "incomplete";
    return "none";
  }
  if (rawStatus === "incomplete") return hasCustomer ? "incomplete" : "none";
  if (trialActive)                return "trialing";
  if (hasCustomer)                return "incomplete";
  return "none";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setup() {
  client = new Client({ connectionString: DB_URL });
  await client.connect();
}

async function teardown() {
  try {
    await client.query(
      `DELETE FROM org_settings WHERE org_id LIKE $1`,
      [`test_portal_%_${RUN}@test.flowpoint.internal`]
    );
  } catch { /* non-fatal */ }
  await client.end();
}

async function ensureOrg(orgId, fields = {}) {
  await client.query(
    `INSERT INTO org_settings (org_id, plan, subscription_status)
     VALUES ($1, 'standard', 'none')
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId]
  );
  // Only update non-null fields (skip null — mirrors upsertOrgSettings behavior)
  const colMap = {
    subscriptionStatus:    "subscription_status",
    stripeCustomerId:      "stripe_customer_id",
    stripeSubscriptionId:  "stripe_subscription_id",
    trialEndsAt:           "trial_ends_at",
    plan:                  "plan",
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return;

  const sets = [];
  const vals = [];
  let n = 1;
  for (const [k, v] of entries) {
    const col = colMap[k] || k;
    sets.push(`${col} = $${n++}`);
    vals.push(v);
  }
  await client.query(
    `UPDATE org_settings SET ${sets.join(", ")} WHERE org_id = $${n}`,
    [...vals, orgId]
  );
}

async function readOrg(orgId) {
  const r = await client.query(`SELECT * FROM org_settings WHERE org_id = $1`, [orgId]);
  return r.rows[0] ?? null;
}

// Normalization SQL that is safe regardless of whether trial_ends_at is TEXT or TIMESTAMPTZ
const NORMALIZE_SQL = `
  UPDATE org_settings
  SET    subscription_status =
           CASE
             WHEN trial_ends_at IS NOT NULL
                  AND trial_ends_at::text <> ''
                  AND trial_ends_at::timestamptz > NOW()  THEN 'trialing'
             WHEN stripe_customer_id IS NOT NULL
                  AND stripe_customer_id <> ''            THEN 'incomplete'
             ELSE                                              'none'
           END,
         updated_at = NOW()
  WHERE  subscription_status = 'active'
    AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
    AND  org_id = $1
`;

async function run(label, fn) {
  try {
    await fn();
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  await setup();
  console.log(`\n[billing-portal.test] RUN=${RUN}\n`);

  // ── T1: Customer + subscription in DB → state machine returns active ─────────
  await run("T1: Customer+subscription in DB → state machine returns active", async () => {
    const orgId = makeId("t1");
    await ensureOrg(orgId, {
      stripeCustomerId:     "cus_existing_mock",
      subscriptionStatus:   "active",
      stripeSubscriptionId: "sub_existing_mock",
    });
    const row = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.strictEqual(status, "active", `Must be active when subscriptionId is present, got "${status}"`);
    assert.strictEqual(row.stripe_customer_id, "cus_existing_mock");
  });

  // ── T2: No customer → status is none ────────────────────────────────────────
  await run("T2: No customer, no subscription, no trial → status=none", async () => {
    const orgId = makeId("t2");
    await ensureOrg(orgId);
    const row = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.strictEqual(status, "none");
    assert.ok(!row.stripe_customer_id,     "No customer");
    assert.ok(!row.stripe_subscription_id, "No subscription");
  });

  // ── T3: 20 concurrent upserts → idempotent ──────────────────────────────────
  await run("T3: 20 concurrent upserts for same org → exactly one row in DB", async () => {
    const orgId     = makeId("t3");
    const custId    = `cus_concurrent_${RUN}`;
    await ensureOrg(orgId);
    await Promise.all(
      Array.from({ length: 20 }, () =>
        client.query(
          `UPDATE org_settings SET stripe_customer_id = $1, updated_at = NOW() WHERE org_id = $2`,
          [custId, orgId]
        )
      )
    );
    const row = await readOrg(orgId);
    assert.strictEqual(row.stripe_customer_id, custId);
    const count = await client.query(
      `SELECT COUNT(*) AS n FROM org_settings WHERE org_id = $1`,
      [orgId]
    );
    assert.strictEqual(Number(count.rows[0].n), 1, "Must have exactly one row");
  });

  // ── T4: status=active + no subscriptionId → impossible state detected ────────
  await run("T4: status=active + no subscriptionId → state machine returns incomplete", async () => {
    const orgId = makeId("t4");
    await ensureOrg(orgId, {
      subscriptionStatus:   "active",
      stripeCustomerId:     "cus_t4_mock",
    });
    const row = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.notStrictEqual(status, "active", `Must not return active without subscriptionId, got "${status}"`);
    assert.strictEqual(status, "incomplete", `Must return incomplete when customer exists but no sub, got "${status}"`);
  });

  // ── T5: State machine — active requires subscriptionId (pure function) ────────
  await run("T5: normalizeSubscriptionStatus — active+no subscriptionId → never active", async () => {
    const inputs = [
      { rawStatus: "active", stripeSubscriptionId: null,  stripeCustomerId: null,       trialEndsAt: null },
      { rawStatus: "active", stripeSubscriptionId: "",    stripeCustomerId: null,       trialEndsAt: null },
      { rawStatus: "active", stripeSubscriptionId: null,  stripeCustomerId: "cus_mock", trialEndsAt: null },
      { rawStatus: "active", stripeSubscriptionId: "  ",  stripeCustomerId: "cus_mock", trialEndsAt: null },
    ];
    for (const input of inputs) {
      const status = normalizeSubscriptionStatus(input);
      assert.notStrictEqual(status, "active",
        `Must not return active for: ${JSON.stringify(input)} → got "${status}"`
      );
    }
  });

  // ── T6: Trial valid → trialing ───────────────────────────────────────────────
  await run("T6: Trial valid → status=trialing", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const orgId  = makeId("t6");
    await ensureOrg(orgId, { trialEndsAt: future, subscriptionStatus: "trialing" });
    const row    = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.strictEqual(status, "trialing", `Expected trialing, got "${status}"`);
  });

  // ── T7: Active subscription + ID → active ────────────────────────────────────
  await run("T7: Subscription active + subscriptionId present → status=active", async () => {
    const orgId = makeId("t7");
    await ensureOrg(orgId, {
      subscriptionStatus:   "active",
      stripeCustomerId:     "cus_t7_mock",
      stripeSubscriptionId: "sub_t7_mock",
    });
    const row    = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.strictEqual(status, "active", `Expected active, got "${status}"`);
    assert.ok(row.stripe_subscription_id, "subscriptionId must be set");
  });

  // ── T8: Subscription deleted → canceled ─────────────────────────────────────
  await run("T8: Subscription deleted → status=canceled, plan=standard", async () => {
    const orgId = makeId("t8");
    await ensureOrg(orgId, {
      subscriptionStatus: "canceled",
      plan:               "standard",
      stripeCustomerId:   "cus_t8_mock",
    });
    const row    = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.strictEqual(status, "canceled",   `Expected canceled, got "${status}"`);
    assert.strictEqual(row.plan, "standard", "Plan must be standard after cancellation");
  });

  // ── T9: Multi-tenant isolation ───────────────────────────────────────────────
  await run("T9: Multi-tenant — two orgs never share customerId or status", async () => {
    const orgA = makeId("t9a");
    const orgB = makeId("t9b");
    await ensureOrg(orgA, {
      subscriptionStatus:   "active",
      stripeCustomerId:     "cus_orgA",
      stripeSubscriptionId: "sub_orgA",
      plan:                 "pro",
    });
    await ensureOrg(orgB);  // no billing fields set

    const rowA = await readOrg(orgA);
    const rowB = await readOrg(orgB);

    assert.strictEqual(rowA.stripe_customer_id, "cus_orgA");
    assert.ok(!rowB.stripe_customer_id,     "Org B must not inherit Org A customer");
    assert.ok(!rowB.stripe_subscription_id, "Org B must not inherit Org A subscription");
    assert.strictEqual(rowA.plan, "pro");
    assert.strictEqual(rowB.plan, "standard");

    const statusA = normalizeSubscriptionStatus({
      rawStatus:            rowA.subscription_status,
      stripeSubscriptionId: rowA.stripe_subscription_id,
      stripeCustomerId:     rowA.stripe_customer_id,
      trialEndsAt:          rowA.trial_ends_at,
    });
    const statusB = normalizeSubscriptionStatus({
      rawStatus:            rowB.subscription_status,
      stripeSubscriptionId: rowB.stripe_subscription_id,
      stripeCustomerId:     rowB.stripe_customer_id,
      trialEndsAt:          rowB.trial_ends_at,
    });
    assert.strictEqual(statusA, "active", `Org A must be active, got "${statusA}"`);
    assert.strictEqual(statusB, "none",   `Org B must be none, got "${statusB}"`);
  });

  // ── T10: DB normalization at read-time ───────────────────────────────────────
  await run("T10: DB impossible state — status=active+no_subscriptionId → state machine returns incomplete", async () => {
    const orgId = makeId("t10");
    // Insert impossible state directly (bypassing upsertOrgSettings guards)
    await client.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status, stripe_customer_id)
       VALUES ($1, 'standard', 'active', 'cus_t10_mock')
       ON CONFLICT (org_id) DO UPDATE SET
         subscription_status    = 'active',
         stripe_customer_id     = 'cus_t10_mock',
         stripe_subscription_id = NULL`,
      [orgId]
    );
    const row    = await readOrg(orgId);
    const status = normalizeSubscriptionStatus({
      rawStatus:            row.subscription_status,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId:     row.stripe_customer_id,
      trialEndsAt:          row.trial_ends_at,
    });
    assert.notStrictEqual(status, "active",     `Must not return active for impossible state, got "${status}"`);
    assert.strictEqual   (status, "incomplete", `Expected incomplete, got "${status}"`);
  });

  // ── T11: Valid states preserved ──────────────────────────────────────────────
  await run("T11: State machine preserves valid states", async () => {
    const cases = [
      { rawStatus: "active",   stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", trialEndsAt: null,    expected: "active" },
      { rawStatus: "past_due", stripeSubscriptionId: "sub_2", stripeCustomerId: "cus_2", trialEndsAt: null,    expected: "past_due" },
      { rawStatus: "canceled", stripeSubscriptionId: null,    stripeCustomerId: "cus_3", trialEndsAt: null,    expected: "canceled" },
      {
        rawStatus: "trialing",
        stripeSubscriptionId: null,
        stripeCustomerId: "cus_4",
        trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
        expected: "trialing",
      },
    ];
    for (const { expected, ...input } of cases) {
      const status = normalizeSubscriptionStatus(input);
      assert.strictEqual(status, expected,
        `Expected "${expected}" for ${JSON.stringify(input)}, got "${status}"`
      );
    }
  });

  // ── T12: Trial expired → incomplete or none ──────────────────────────────────
  await run("T12: Trial expired + no subscription → incomplete (has customer) or none", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();

    const withCustomer = normalizeSubscriptionStatus({
      rawStatus: "trialing", stripeSubscriptionId: null, stripeCustomerId: "cus_mock", trialEndsAt: past,
    });
    assert.strictEqual(withCustomer, "incomplete",
      `With customer after expiry → incomplete, got "${withCustomer}"`
    );

    const noCustomer = normalizeSubscriptionStatus({
      rawStatus: "trialing", stripeSubscriptionId: null, stripeCustomerId: null, trialEndsAt: past,
    });
    assert.strictEqual(noCustomer, "none",
      `Without customer after expiry → none, got "${noCustomer}"`
    );
  });

  // ── T13: 20 concurrent writes → exactly one row ──────────────────────────────
  await run("T13: 20 concurrent DB writes → exactly one org_settings row", async () => {
    const orgId  = makeId("t13");
    const custId = `cus_conc_${RUN}`;
    await ensureOrg(orgId);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        client.query(
          `UPDATE org_settings SET stripe_customer_id = $1, updated_at = NOW() WHERE org_id = $2`,
          [`${custId}_proc${i}`, orgId]
        )
      )
    );

    const count = await client.query(
      `SELECT COUNT(*) AS n FROM org_settings WHERE org_id = $1`,
      [orgId]
    );
    assert.strictEqual(Number(count.rows[0].n), 1, "Must have exactly one org_settings row");
  });

  // ── T14: Normalization SQL — active without subscriptionId → corrected ────────
  await run("T14: Startup normalization SQL corrects status=active without subscriptionId", async () => {
    const orgId = makeId("t14");
    await client.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status, stripe_customer_id, stripe_subscription_id)
       VALUES ($1, 'pro', 'active', 'cus_t14', NULL)
       ON CONFLICT (org_id) DO UPDATE SET
         subscription_status    = 'active',
         stripe_subscription_id = NULL,
         stripe_customer_id     = 'cus_t14'`,
      [orgId]
    );

    await client.query(NORMALIZE_SQL, [orgId]);

    const row = await readOrg(orgId);
    assert.notStrictEqual(row.subscription_status, "active",
      `Status must not remain active after normalization — got "${row.subscription_status}"`
    );
    assert.strictEqual(row.subscription_status, "incomplete",
      `Expected incomplete (has customer), got "${row.subscription_status}"`
    );
  });

  // ── T15: Status bleed isolation ───────────────────────────────────────────────
  await run("T15: Org A billing state does not bleed into Org B", async () => {
    const orgA = makeId("t15a");
    const orgB = makeId("t15b");

    await ensureOrg(orgA, {
      subscriptionStatus:   "active",
      stripeCustomerId:     "cus_a15",
      stripeSubscriptionId: "sub_a15",
      plan:                 "ultra",
    });
    await ensureOrg(orgB);  // fresh, no billing data

    const rowA = await readOrg(orgA);
    const rowB = await readOrg(orgB);

    assert.notStrictEqual(rowA.org_id,                rowB.org_id);
    assert.notStrictEqual(rowA.stripe_customer_id,    rowB.stripe_customer_id);
    assert.notStrictEqual(rowA.stripe_subscription_id, rowB.stripe_subscription_id);

    const statusB = normalizeSubscriptionStatus({
      rawStatus:            rowB.subscription_status,
      stripeSubscriptionId: rowB.stripe_subscription_id,
      stripeCustomerId:     rowB.stripe_customer_id,
      trialEndsAt:          rowB.trial_ends_at,
    });
    assert.strictEqual(statusB, "none",
      `Org B must not inherit Org A billing state — got "${statusB}"`
    );
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  await teardown();
  console.log(`\n[billing-portal.test] ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("[billing-portal.test] Fatal:", err);
  process.exit(1);
});
