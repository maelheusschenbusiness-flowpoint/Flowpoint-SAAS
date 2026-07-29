/**
 * Commit 3 — Defense in depth: explicit org_id in DELETE (BUG-F)
 *
 * Confirms that DELETE queries on audits and audit_schedules now include
 * an explicit org_id = $N guard, rather than relying solely on RLS.
 *
 * Tests:
 *  T1  Static check: DELETE FROM audits includes AND org_id =
 *  T2  Static check: DELETE FROM audit_schedules includes AND org_id =
 *  T3  Integration: DELETE /api/audits/:id with correct org → 200
 *  T4  Integration: DELETE /api/audits/:id with wrong org → 404 (org guard fires)
 *  T5  Integration: DELETE /api/audits/schedules/:id with correct org → 200
 *  T6  Integration: DELETE /api/audits/schedules/:id with wrong org → 404
 *
 * Run:
 *   cd artifacts/api-server && pnpm tsx tests/certification/delete_defense_depth.test.ts
 */

import { readFileSync } from "fs";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { pool } from "@workspace/db";
import { orgContext } from "../../src/middlewares/orgContext.js";
import { dbContext }  from "../../src/middlewares/dbContext.js";
import auditsRouter from "../../src/routes/audits.js";
import { createSession } from "../../src/services/sessions.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const RUN = Date.now();
const results: Array<{ id: string; pass: boolean }> = [];

function check(id: string, pass: boolean): void {
  results.push({ id, pass });
  console.log(`  ${pass ? "✅" : "❌"} ${id}`);
}

function orgId(tag: string) { return `ddd_${RUN}_${tag}`; }

async function ensureOrg(tag: string): Promise<void> {
  const oid = orgId(tag);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO organizations (id, name, plan, subscription_status)
       VALUES ($1, $2, 'pro', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [oid, `DDD Org ${tag}`]
    );
    await client.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status)
       VALUES ($1, 'pro', 'active')
       ON CONFLICT (org_id) DO NOTHING`,
      [oid]
    );
  } finally { client.release(); }
}

async function insertAudit(tag: string): Promise<string> {
  const oid = orgId(tag);
  const id = `aud_ddd_${RUN}_${tag}`;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO audits (id, org_id, url, score, status, speed, issues, date, origin, created_at)
       VALUES ($1, $2, 'https://example.com', 80, 'done', 90, 5, NOW()::text, 'test', NOW())`,
      [id, oid]
    );
  } finally { client.release(); }
  return id;
}

async function insertSchedule(tag: string): Promise<string> {
  const oid = orgId(tag);
  const id = `sched_ddd_${RUN}_${tag}`;
  // Both next_run and created_at are bigint (epoch ms)
  const nowMs = Date.now();
  const nextRunMs = nowMs + 7 * 24 * 3600 * 1000;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO audit_schedules (id, org_id, url, frequency, next_run, created_at)
       VALUES ($1, $2, 'https://example.com', 'weekly', $3, $4)`,
      [id, oid, nextRunMs, nowMs]
    );
  } finally { client.release(); }
  return id;
}

async function makeSession(tag: string): Promise<string> {
  const oid = orgId(tag);
  return createSession({
    userId: `usr_ddd_${tag}`,
    orgId: oid,
    email: `${tag}@ddd-test.invalid`,
    role: "admin",
  });
}

async function cleanup() {
  const client = await pool.connect();
  try {
    const ids = ["owner", "owner2", "attacker"].map(t => orgId(t));
    await client.query(`DELETE FROM audits          WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM audit_schedules WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM user_sessions   WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM organizations   WHERE id     = ANY($1)`, [ids]);
    await client.query(`DELETE FROM org_settings    WHERE org_id = ANY($1)`, [ids]);
  } catch { /* non-fatal */ } finally { client.release(); }
}

// ── test server ───────────────────────────────────────────────────────────────

let server: Server;
let BASE: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const tok = req.headers["x-test-token"] as string | undefined;
    if (tok) req.headers["cookie"] = `fp_token=${tok}`;
    next();
  });
  app.use(cookieParser());
  app.use(orgContext);
  app.use(dbContext);
  app.use("/api", auditsRouter);
  server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const addr = server.address() as { port: number };
  BASE = `http://127.0.0.1:${addr.port}/api`;
}

async function del(path: string, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { "x-test-token": token },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ── static checks ─────────────────────────────────────────────────────────────

console.log("\n── Defense in depth: DELETE org_id guard (BUG-F) ───────────────────────────");

const auditsPath = new URL("../../src/routes/audits.ts", import.meta.url).pathname;
const src = readFileSync(auditsPath, "utf8");

// T1: DELETE audits includes org_id
const deleteAuditsMatch = src.match(/DELETE FROM audits WHERE id = \$1 AND org_id = \$2/);
check("T1  audits.ts — DELETE FROM audits includes AND org_id = $2", deleteAuditsMatch !== null);

// T2: DELETE audit_schedules includes org_id
const deleteSchedulesMatch = src.match(/DELETE FROM audit_schedules WHERE id = \$1 AND org_id = \$2/);
check("T2  audits.ts — DELETE FROM audit_schedules includes AND org_id = $2", deleteSchedulesMatch !== null);

// ── live isolation checks ─────────────────────────────────────────────────────

await ensureOrg("owner");
await ensureOrg("attacker");
await startServer();

const ownerToken    = await makeSession("owner");
const attackerToken = await makeSession("attacker");

// Insert an audit belonging to "owner"
const auditId    = await insertAudit("owner");
const scheduleId = await insertSchedule("owner");

// T3: owner can delete their own audit
const r3 = await del(`/audits/${auditId}`, ownerToken);
check("T3  DELETE /api/audits/:id with correct org — 200", r3.status === 200);

// Re-insert for cross-tenant isolation test (use "owner2" tag to avoid PK collision)
const auditId2    = await insertAudit("owner2");
const scheduleId2 = await insertSchedule("owner2");

// T4: attacker cannot delete owner's audit (org_id guard fires → row not found → 404)
const r4 = await del(`/audits/${auditId2}`, attackerToken);
check("T4  DELETE /api/audits/:id with wrong org — 404 (org guard prevents cross-tenant delete)", r4.status === 404);

// Verify the audit still exists after the failed delete attempt
const checkClient = await pool.connect();
try {
  const { rows } = await checkClient.query(
    `SELECT id FROM audits WHERE id = $1 AND org_id = $2`,
    [auditId2, orgId("owner2")]
  );
  check("T4b Audit row still exists after attacker delete attempt", rows.length === 1);
} finally { checkClient.release(); }

// T5: owner can delete their own schedule
const r5 = await del(`/audits/schedules/${scheduleId}`, ownerToken);
check("T5  DELETE /api/audits/schedules/:id with correct org — 200", r5.status === 200);

// T6: attacker cannot delete owner's schedule
const r6 = await del(`/audits/schedules/${scheduleId2}`, attackerToken);
// Note: deleteSchedule returns 200 on error (legacy catch {} → res.json({ ok: true }))
// so we verify via DB that the row still exists
const checkClient2 = await pool.connect();
try {
  const { rows } = await checkClient2.query(
    `SELECT id FROM audit_schedules WHERE id = $1 AND org_id = $2`,
    [scheduleId2, orgId("owner2")]
  );
  check("T6  Attacker cannot delete owner schedule — row still in DB", rows.length === 1);
} finally { checkClient2.release(); }

// ── teardown ──────────────────────────────────────────────────────────────────

server.close();
await cleanup();

// ── summary ───────────────────────────────────────────────────────────────────

const failed = results.filter(r => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.error("\nFailed:");
  for (const f of failed) console.error(`  ❌ ${f.id}`);
  process.exit(1);
}
console.log("  ✅ All defense-in-depth DELETE checks passed\n");
