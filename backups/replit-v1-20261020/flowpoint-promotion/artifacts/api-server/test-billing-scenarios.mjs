/**
 * TEST B — Billing Downgrade Scenarios
 * Runs 4 scenarios without any code changes.
 * Inserts test orgs + sessions directly in DB, calls the live API, then cleans up.
 */
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL;
const API    = 'http://127.0.0.1:8081';
const pool   = new Pool({ connectionString: DB_URL });

const RUN = Date.now().toString(36);
function uid(label) { return `test-${label}-${RUN}`; }

// ── helpers ──────────────────────────────────────────────────────────────────
async function createOrg(client, { orgId, plan, subStatus, stripeCustomerId, stripeSubscriptionId, trialEndsAt }) {
  // Upsert into organizations
  await client.query(`
    INSERT INTO organizations (id, name, owner_email, owner_first_name, plan, subscription_status,
      stripe_customer_id, stripe_subscription_id, trial_ends_at, trial_started_at, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),NOW())
    ON CONFLICT (id) DO UPDATE SET
      plan=EXCLUDED.plan,
      subscription_status=EXCLUDED.subscription_status,
      stripe_customer_id=EXCLUDED.stripe_customer_id,
      stripe_subscription_id=EXCLUDED.stripe_subscription_id,
      trial_ends_at=EXCLUDED.trial_ends_at
  `, [orgId, `Test Org ${orgId}`, `${orgId}@test.flowpoint`, 'TestUser', plan, subStatus,
      stripeCustomerId, stripeSubscriptionId, trialEndsAt]);
}

async function createSession(client, { token, userId, orgId }) {
  const expiresAt = new Date(Date.now() + 86400_000);
  await client.query(`
    INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at)
    VALUES ($1,$2,$3,$4,'owner',$5,NOW())
    ON CONFLICT DO NOTHING
  `, [token, userId, orgId, `${orgId}@test.flowpoint`, expiresAt]);
}

async function apiPost(path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, json };
}

async function getOrgFromDB(client, orgId) {
  const r = await client.query(
    `SELECT plan, subscription_status, stripe_customer_id, stripe_subscription_id,
            trial_ends_at, trial_started_at, pending_plan, pending_plan_date
     FROM organizations WHERE id=$1`, [orgId]);
  return r.rows[0] || null;
}

async function apiGet(path, token) {
  const r = await fetch(`${API}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  let json;
  try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, json };
}

// ── cleanup ───────────────────────────────────────────────────────────────────
async function cleanup(client, orgIds) {
  for (const id of orgIds) {
    await client.query(`DELETE FROM user_sessions WHERE org_id=$1`, [id]).catch(()=>{});
    await client.query(`DELETE FROM org_addons WHERE org_id=$1`, [id]).catch(()=>{});
    await client.query(`DELETE FROM organizations WHERE id=$1`, [id]).catch(()=>{});
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    label: 'S1 — Trial Pro, no Stripe sub → Standard immédiat',
    orgId: uid('s1'),
    plan: 'pro',
    subStatus: 'trialing',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    trialEndsAt: new Date(Date.now() + 7*86400_000).toISOString(),
    targetPlan: 'standard',
    expectDowngradeImmediate: true,
  },
  {
    label: 'S2 — Trial Ultra, no Stripe sub → Standard immédiat',
    orgId: uid('s2'),
    plan: 'ultra',
    subStatus: 'trialing',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    trialEndsAt: new Date(Date.now() + 7*86400_000).toISOString(),
    targetPlan: 'standard',
    expectDowngradeImmediate: true,
  },
  {
    label: 'S3 — Pro actif avec Customer Stripe (pas de sub réelle) → comportement sans-sub',
    orgId: uid('s3'),
    plan: 'pro',
    subStatus: 'active',
    stripeCustomerId: null,   // no real customer = triggers noSubscription path
    stripeSubscriptionId: null,
    trialEndsAt: null,
    targetPlan: 'standard',
    expectDowngradeImmediate: true, // no sub → our new isDowngrade path
  },
  {
    label: 'S4 — Ultra actif avec Customer Stripe (pas de sub réelle) → comportement sans-sub',
    orgId: uid('s4'),
    plan: 'ultra',
    subStatus: 'active',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    trialEndsAt: null,
    targetPlan: 'standard',
    expectDowngradeImmediate: true,
  },
];

const results = [];
const client  = await pool.connect();

try {
  // Phase 1 — Setup
  for (const s of SCENARIOS) {
    await createOrg(client, s);
    const token = crypto.randomBytes(32).toString('hex');
    s.token = token;
    await createSession(client, { token, userId: s.orgId, orgId: s.orgId });
  }

  // Phase 2 — Run each scenario
  for (const s of SCENARIOS) {
    const trialBefore = (await getOrgFromDB(client, s.orgId))?.trial_ends_at;

    // Capture /api/me before
    const meBefore = await apiGet('/api/me', s.token);

    // Call billing/upgrade
    const { status, json } = await apiPost('/api/billing/upgrade', { plan: s.targetPlan }, s.token);

    // Read DB after
    const dbAfter = await getOrgFromDB(client, s.orgId);

    // Capture /api/me after (authoritative)
    const meAfter = await apiGet('/api/me', s.token);

    // Checks
    const checks = {
      httpStatus:        status,
      apiResponse:       json,
      dbPlanAfter:       dbAfter?.plan,
      dbStatusAfter:     dbAfter?.subscription_status,
      dbStripeCustomer:  dbAfter?.stripe_customer_id,
      dbStripeSub:       dbAfter?.stripe_subscription_id,
      trialEndsBefore:   trialBefore ? new Date(trialBefore).toISOString() : null,
      trialEndsAfter:    dbAfter?.trial_ends_at ? new Date(dbAfter.trial_ends_at).toISOString() : null,
      trialDateChanged:  String(trialBefore) !== String(dbAfter?.trial_ends_at),
      mePlanAfter:       meAfter.json?.plan,
      pendingPlan:       dbAfter?.pending_plan,
      pendingPlanDate:   dbAfter?.pending_plan_date,
    };

    const immediateOk   = json.upgraded === true && json.noSubDowngrade === true && dbAfter?.plan === s.targetPlan;
    const scheduledOk   = json.downgrade === true && dbAfter?.plan === s.plan; // plan unchanged, pending set
    const trialIntact   = !checks.trialDateChanged || trialBefore == null;
    const noNewCustomer = !dbAfter?.stripe_customer_id;
    const noNewSub      = !dbAfter?.stripe_subscription_id;

    let verdict;
    if (s.expectDowngradeImmediate) {
      verdict = immediateOk && trialIntact && noNewCustomer && noNewSub ? 'PASS' : 'FAIL';
    } else {
      verdict = scheduledOk && trialIntact ? 'PASS' : 'FAIL';
    }

    results.push({ label: s.label, verdict, checks });
  }

} finally {
  await cleanup(client, SCENARIOS.map(s => s.orgId));
  client.release();
  await pool.end();
}

// ── Report ────────────────────────────────────────────────────────────────────
for (const r of results) {
  console.log('\n' + '═'.repeat(72));
  console.log(`  ${r.verdict === 'PASS' ? '✅' : '❌'}  ${r.label}`);
  console.log(`  Verdict: ${r.verdict}`);
  console.log('  HTTP status:        ', r.checks.httpStatus);
  console.log('  API response:       ', JSON.stringify(r.checks.apiResponse));
  console.log('  DB plan after:      ', r.checks.dbPlanAfter);
  console.log('  DB status after:    ', r.checks.dbStatusAfter);
  console.log('  /api/me plan after: ', r.checks.mePlanAfter);
  console.log('  Trial ends before:  ', r.checks.trialEndsBefore);
  console.log('  Trial ends after:   ', r.checks.trialEndsAfter);
  console.log('  Trial date changed: ', r.checks.trialDateChanged ? '⚠ YES' : 'no');
  console.log('  Stripe customer:    ', r.checks.dbStripeCustomer || '(none)');
  console.log('  Stripe sub:         ', r.checks.dbStripeSub || '(none)');
  console.log('  pendingPlan:        ', r.checks.pendingPlan || '(none)');
}
console.log('\n' + '═'.repeat(72));
