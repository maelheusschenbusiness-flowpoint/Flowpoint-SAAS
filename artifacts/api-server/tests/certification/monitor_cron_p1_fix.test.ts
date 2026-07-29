/**
 * Bug #238 — monitor-cron: store.me singleton removed from alert email resolution
 *
 * Confirms:
 *  T1  store.me is no longer imported in monitor-cron.ts (static check)
 *  T1b store.me usage removed from monitor-cron.ts
 *  T2  evaluateAlertRulesForAudit completes without error when org_email is NULL
 *  T3  evaluateAlertRulesForAudit completes without error when org_email is set
 *  T4  Cross-tenant isolation: org Y evaluation does NOT trigger org X's rules
 *  T5  LEFT JOIN organizations.owner_email is present in cron source
 *  T6  Alert event is written even when org_email is NULL (rule still fires)
 *  T7  LEFT JOIN resolves correct org_email for alert rules
 */

import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { pool } from "@workspace/db";
import { evaluateAlertRulesForAudit } from "../../src/services/monitor-cron.js";

const RUN = Date.now();

// ── helpers ──────────────────────────────────────────────────────────────────

async function ensureOrg(orgId: string, ownerEmail: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO organizations (id, name, owner_email, plan, created_at)
     VALUES ($1, $2, $3, 'pro', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [orgId, `MC Test Org ${RUN}`, ownerEmail]
  );
}

async function insertAlertRule(
  orgId: string,
  opts: { threshold?: number; operator?: string }
): Promise<void> {
  const { threshold = 50, operator = "lt" } = opts;
  const ruleId = randomBytes(8).toString("hex");
  await pool.query(
    `INSERT INTO alert_rules (id, org_id, name, type, threshold, operator, enabled, channels, created_at)
     VALUES ($1, $2, $3, 'seo_score', $4, $5, true, '["email"]', NOW())`,
    [ruleId, orgId, `MC Rule ${RUN}`, threshold, operator]
  );
}

const results: Array<{ id: string; pass: boolean }> = [];
function check(id: string, pass: boolean): void {
  results.push({ id, pass });
  console.log(`  ${pass ? "✅" : "❌"} ${id}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log("\n── Bug #238: monitor-cron store.me removal ─────────────────────────────────");

// ── T1/T1b: static check — store.me no longer in monitor-cron.ts ─────────────
const cronPath = new URL("../../src/services/monitor-cron.ts", import.meta.url).pathname;
const cronSrc = readFileSync(cronPath, "utf8");
const hasStoreMeImport = cronSrc.includes("from \"./store.js\"") || cronSrc.includes("from './store.js'");
const hasStoreMeUsage  = /store\.me/.test(cronSrc);
check("T1  store.me import removed from monitor-cron.ts",  !hasStoreMeImport);
check("T1b store.me usage removed from monitor-cron.ts",   !hasStoreMeUsage);

// ── T2: function does not throw when owner_email is NULL ─────────────────────
const ORG_NULL = `mc-null-${RUN}`;
await ensureOrg(ORG_NULL, null);
await insertAlertRule(ORG_NULL, { threshold: 90, operator: "lt" });

let threw2 = false;
try {
  // Score 40 < threshold 90 → rule triggers, owner_email NULL → no email, no crash
  await evaluateAlertRulesForAudit("https://example-null.test", 40, ORG_NULL);
} catch {
  threw2 = true;
}
check("T2  evaluateAlertRulesForAudit does not throw when org_email is NULL", !threw2);

// ── T3: function does not throw when owner_email is set ──────────────────────
const ORG_REAL = `mc-real-${RUN}`;
await ensureOrg(ORG_REAL, `mc-owner-${RUN}@test.flowpoint`);
await insertAlertRule(ORG_REAL, { threshold: 90, operator: "lt" });

let threw3 = false;
try {
  await evaluateAlertRulesForAudit("https://example-real.test", 40, ORG_REAL);
} catch {
  threw3 = true;
}
check("T3  evaluateAlertRulesForAudit does not throw when org_email is set", !threw3);

// ── T4: cross-tenant isolation ────────────────────────────────────────────────
const ORG_X = `mc-x-${RUN}`;
const ORG_Y = `mc-y-${RUN}`;
await ensureOrg(ORG_X, `mc-x-${RUN}@test.flowpoint`);
await ensureOrg(ORG_Y, `mc-y-${RUN}@test.flowpoint`);
// Org X has a rule that fires when score > 30
await insertAlertRule(ORG_X, { threshold: 30, operator: "gt" });

const eventsBefore = await pool.query(
  `SELECT COUNT(*) FROM alert_events WHERE org_id = $1`, [ORG_X]
);
// Evaluate for Org Y — must NOT trigger Org X's rules
await evaluateAlertRulesForAudit("https://example-y.test", 80, ORG_Y);
const eventsAfter = await pool.query(
  `SELECT COUNT(*) FROM alert_events WHERE org_id = $1`, [ORG_X]
);
check("T4  Org Y evaluation does not trigger Org X's alert rules",
  Number(eventsBefore.rows[0].count) === Number(eventsAfter.rows[0].count)
);

// ── T5: source check — LEFT JOIN organizations.owner_email present ────────────
const hasOrgJoin = cronSrc.includes("LEFT JOIN organizations") && cronSrc.includes("owner_email");
check("T5  Monitor-cron query uses LEFT JOIN organizations.owner_email", hasOrgJoin);

// ── T6: alert event written even when org_email is NULL ──────────────────────
const eventsNull = await pool.query(
  `SELECT COUNT(*) FROM alert_events WHERE org_id = $1`, [ORG_NULL]
);
// Rule DID trigger (score 40 < threshold 90 with operator lt) → event should be written
check("T6  Alert event written even when org_email is NULL (rule still fires)",
  Number(eventsNull.rows[0].count) >= 1
);

// ── T7: LEFT JOIN resolves correct org_email ──────────────────────────────────
const joinRow = await pool.query(
  `SELECT o.owner_email AS org_email
   FROM alert_rules ar
   LEFT JOIN organizations o ON ar.org_id = o.id
   WHERE ar.org_id = $1 AND ar.enabled = true LIMIT 1`,
  [ORG_REAL]
);
check("T7  LEFT JOIN resolves correct org_email for alert rules",
  joinRow.rows[0]?.org_email === `mc-owner-${RUN}@test.flowpoint`
);

// ── cleanup ───────────────────────────────────────────────────────────────────
const cleanOrgs = [ORG_NULL, ORG_REAL, ORG_X, ORG_Y];
await pool.query(`DELETE FROM alert_events WHERE org_id = ANY($1::text[])`, [cleanOrgs]);
await pool.query(`DELETE FROM alert_rules  WHERE org_id = ANY($1::text[])`, [cleanOrgs]);
await pool.query(`DELETE FROM organizations WHERE id = ANY($1::text[])`,    [cleanOrgs]);

// ── summary ───────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n${"─".repeat(60)}`);
console.log(`Monitor-cron #238 results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
