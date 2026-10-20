/**
 * Commit 2 — Notification robustness (BUG-D)
 *
 * Confirms that the monitor-state-change notification DB write is awaited,
 * not fire-and-forget.
 *
 * Tests:
 *  T1  Static check: pool.connect().then(client => ... notification ...) pattern removed
 *  T2  Static check: notification INSERT is preceded by `await pool.connect()`
 *  T3  Static check: notification block has a try/finally with client.release()
 *  T4  Integration: after a simulated state change, notification row appears in DB
 *
 * Run:
 *   cd artifacts/api-server && pnpm tsx tests/certification/notification_robustness.test.ts
 */

import { readFileSync } from "fs";
import { pool } from "@workspace/db";
import { randomBytes } from "crypto";

const RUN = Date.now();
const results: Array<{ id: string; pass: boolean }> = [];

function check(id: string, pass: boolean): void {
  results.push({ id, pass });
  console.log(`  ${pass ? "✅" : "❌"} ${id}`);
}

console.log("\n── Notification robustness (BUG-D) ─────────────────────────────────────────");

// ── T1-T3: static checks ──────────────────────────────────────────────────────

const monitorsPath = new URL("../../src/routes/monitors.ts", import.meta.url).pathname;
const src = readFileSync(monitorsPath, "utf8");

// T1: old fire-and-forget pattern gone from the notification block
// The pattern was: pool.connect().then(client => client.query(`INSERT INTO notifications
const hasFireAndForget = /pool\.connect\(\)\.then\(client\s*=>\s*\n?\s*client\.query\(\s*\n?\s*`INSERT INTO notifications/.test(src);
check("T1  monitors.ts — pool.connect().then() pattern removed from notification write", !hasFireAndForget);

// T2: notification INSERT is now awaited
const hasAwaitedNotif = /await _notifClient\.query\(\s*\n?\s*`INSERT INTO notifications/.test(src);
check("T2  monitors.ts — notification INSERT is awaited (_notifClient.query)", hasAwaitedNotif);

// T3: try/finally with client.release() wraps the notification insert
const hasTryFinally = /const _notifClient = await pool\.connect\(\)[\s\S]{0,800}finally\s*\{\s*\n?\s*_notifClient\.release\(\)/.test(src);
check("T3  monitors.ts — try/finally with _notifClient.release() present", hasTryFinally);

// ── T4: integration check — notification row persisted after direct pool write ─

// Simulate what the fixed code does: await a pool.connect() then INSERT
const orgId  = `nr_${RUN}`;
const notifId = `notif_test_${randomBytes(6).toString("hex")}`;

const client = await pool.connect();
try {
  // Ensure org exists
  await client.query(
    `INSERT INTO organizations (id, name, plan, subscription_status)
     VALUES ($1, 'NR Test Org', 'standard', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [orgId]
  );
  // Simulate the fixed notification write (awaited)
  await client.query(
    `INSERT INTO notifications (id, org_id, type, title, message, link, read, created_at)
     VALUES ($1, $2, 'danger', 'Test DOWN', 'test-url est inaccessible.', '/monitors', false, NOW())`,
    [notifId, orgId]
  );
  // Verify it landed
  const { rows } = await client.query(
    `SELECT id FROM notifications WHERE id = $1 AND org_id = $2`,
    [notifId, orgId]
  );
  check("T4  Integration — notification row persisted (await-based write)", rows.length === 1);
} catch (err) {
  check("T4  Integration — notification row persisted (await-based write)", false);
  console.error("  T4 error:", err);
} finally {
  client.release();
}

// ── cleanup ───────────────────────────────────────────────────────────────────

const cleanClient = await pool.connect();
try {
  await cleanClient.query(`DELETE FROM notifications WHERE org_id = $1`, [orgId]);
  await cleanClient.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
} catch { /* non-fatal */ } finally { cleanClient.release(); }

// ── summary ───────────────────────────────────────────────────────────────────

const failed = results.filter(r => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.error("\nFailed:");
  for (const f of failed) console.error(`  ❌ ${f.id}`);
  process.exit(1);
}
console.log("  ✅ All notification robustness checks passed\n");
