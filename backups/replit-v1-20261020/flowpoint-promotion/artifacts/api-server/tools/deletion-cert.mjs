/**
 * deletion-cert.mjs — FlowPoint Account Deletion Certification
 *
 * Proves that DELETE /api/billing/account removes every trace of an account.
 *
 * Method
 * ------
 * 1. Create a real org + owner user + a second member + a live session.
 * 2. Discover EVERY table carrying an org-scoped or user-scoped column and
 *    seed a real row into each one (values generated from the live column
 *    types, so this exercises the actual schema, not a curated subset).
 * 3. Count all owned rows — the "before" matrix.
 * 4. Call DELETE /api/billing/account over HTTP with the owner's session.
 * 5. Count again — the "after" matrix. Every count must be 0.
 * 6. Replay the old session token — must return 401.
 * 7. Run a full orphan audit across the whole schema.
 * 8. Write tools/deletion-cert-report.json.
 *
 * Usage: node tools/deletion-cert.mjs
 */
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { randomUUID, randomBytes } from "crypto";

const require = createRequire(import.meta.url);
const PG_PATH = "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";
const { Pool } = require(PG_PATH);

const BASE = process.env.CERT_BASE_URL || "http://127.0.0.1:8081";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RUN        = Date.now();
const ORG_ID     = randomUUID();
const OWNER_ID   = randomUUID();
const MEMBER_ID  = randomUUID();
const OWNER_MAIL = `cert-owner-${RUN}@deletion-cert.local`;
const MEMBER_MAIL= `cert-member-${RUN}@deletion-cert.local`;
const TOKEN      = randomBytes(32).toString("hex");

const ORG_COLUMNS  = ["org_id", "organization_id"];
const USER_COLUMNS = [
  "user_id", "user_id_v2", "user_uuid", "owner_id", "created_by", "member_id",
  "invited_by", "invited_by_user_id", "sender_id", "author_id", "updated_by",
  "deleted_by", "assigned_to",
];
const NEVER = new Set(["schema_migrations", "canonical_seeds"]);
const TERMINAL = new Set(["organizations", "org_settings", "organization_members", "users"]);

const line = "═".repeat(72);
const log  = (...a) => console.log(...a);
const q    = (sql, p = []) => pool.query(sql, p);

let PASS = 0, FAIL = 0;
const failures = [];
function check(cond, label, detail = "") {
  if (cond) { PASS++; log(`  ✅ ${label}`); }
  else { FAIL++; failures.push(`${label}${detail ? " — " + detail : ""}`); log(`  ❌ ${label}${detail ? " — " + detail : ""}`); }
}

// ── Value generator driven by the live column type ──────────────────────────
function sampleValue(col) {
  const t = col.data_type;
  const n = col.column_name;
  if (n === "org_id" || n === "organization_id") return ORG_ID;
  if (USER_COLUMNS.includes(n)) return t === "uuid" ? OWNER_ID : OWNER_ID;
  switch (t) {
    case "uuid":                        return randomUUID();
    case "boolean":                     return false;
    case "integer": case "bigint": case "smallint": return 0;
    case "numeric": case "real": case "double precision": return 0;
    case "jsonb": case "json":          return "{}";
    case "ARRAY":                       return "{}";
    case "date":                        return "2026-01-01";
    case "timestamp with time zone":
    case "timestamp without time zone": return "2026-01-01T00:00:00Z";
    case "inet":                        return "127.0.0.1";
    default:                            return `cert-${RUN}`;
  }
}

async function main() {
  log(`\n${line}\n  FlowPoint — Account Deletion Certification\n  org=${ORG_ID}\n  owner=${OWNER_MAIL}\n${line}\n`);

  // ── STEP 1: create the account ────────────────────────────────────────────
  log("── STEP 1 — Create account (org + owner + member + session)");
  await q(`INSERT INTO users (id,email,first_name,last_name,status,email_verified)
           VALUES ($1,$2,'Cert','Owner','active',true)`, [OWNER_ID, OWNER_MAIL]);
  await q(`INSERT INTO users (id,email,first_name,last_name,status,email_verified)
           VALUES ($1,$2,'Cert','Member','active',true)`, [MEMBER_ID, MEMBER_MAIL]);
  await q(`INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,subscription_status,owner_email)
           VALUES ($1,$2,$3,$4,'active','pro','active',$5)`,
          [ORG_ID, `Cert Org ${RUN}`, `cert-org-${RUN}`, OWNER_ID, OWNER_MAIL]);
  await q(`INSERT INTO organization_members (organization_id,user_id,role,status)
           VALUES ($1,$2,'owner','active'),($1,$3,'member','active')`,
          [ORG_ID, OWNER_ID, MEMBER_ID]);
  await q(`INSERT INTO org_settings (org_id,email) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`, [ORG_ID, OWNER_MAIL]).catch(() => {});
  await q(`INSERT INTO user_sessions (token,user_id,org_id,email,role,expires_at,user_id_v2)
           VALUES ($1,$2,$3,$4,'owner',now()+interval '2 hours',$5)`,
          [TOKEN, OWNER_ID, ORG_ID, OWNER_MAIL, OWNER_ID]);
  log(`  created org + 2 users + session\n`);

  // ── STEP 2: discover every owned table and seed it ────────────────────────
  log("── STEP 2 — Discover owned tables and seed real rows");
  const colsRes = await q(
    `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema='public' AND t.table_type='BASE TABLE'`);

  const byTable = new Map();
  for (const r of colsRes.rows) {
    if (NEVER.has(r.table_name)) continue;
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name).push(r);
  }

  // Tables that carry an ownership column.
  const owned = [];
  for (const [table, cols] of byTable) {
    if (TERMINAL.has(table)) continue;
    const ownership = cols.filter(c => ORG_COLUMNS.includes(c.column_name) || USER_COLUMNS.includes(c.column_name));
    if (ownership.length > 0) owned.push({ table, cols, ownership });
  }
  log(`  ${owned.length} tables carry an org- or user-scoped column`);

  const seeded = [], skipped = [];
  for (const { table, cols, ownership } of owned) {
    // Required = NOT NULL without a default, plus every ownership column.
    const required = cols.filter(c =>
      (c.is_nullable === "NO" && !c.column_default) || ownership.some(o => o.column_name === c.column_name));
    const names = [...new Set(required.map(c => c.column_name))];
    const values = names.map(n => sampleValue(cols.find(c => c.column_name === n)));
    const ph = names.map((_, i) => `$${i + 1}`).join(",");
    const sql = `INSERT INTO "${table}" (${names.map(n => `"${n}"`).join(",")}) VALUES (${ph})`;
    try {
      await q(sql, values);
      seeded.push(table);
    } catch (e) {
      skipped.push({ table, reason: String(e.message).split("\n")[0].slice(0, 110) });
    }
  }
  log(`  seeded ${seeded.length} tables, ${skipped.length} not seedable (constraint/FK)\n`);

  // ── STEP 3: "before" matrix ───────────────────────────────────────────────
  log("── STEP 3 — Count owned rows BEFORE deletion");
  const userIds = [OWNER_ID, MEMBER_ID];
  async function ownedCounts() {
    const out = {};
    for (const { table, ownership } of owned) {
      const clauses = [], params = [];
      for (const o of ownership) {
        if (ORG_COLUMNS.includes(o.column_name)) { params.push(ORG_ID); clauses.push(`"${o.column_name}"::text = $${params.length}`); }
        else { params.push(userIds); clauses.push(`"${o.column_name}"::text = ANY($${params.length}::text[])`); }
      }
      try {
        const r = await q(`SELECT COUNT(*)::int n FROM "${table}" WHERE ${clauses.join(" OR ")}`, params);
        if (r.rows[0].n > 0) out[table] = r.rows[0].n;
      } catch { /* table vanished */ }
    }
    for (const [t, pred, v] of [
      ["organizations", "id::text=$1", ORG_ID],
      ["org_settings", "org_id::text=$1", ORG_ID],
      ["organization_members", "organization_id::text=$1", ORG_ID],
    ]) {
      const r = await q(`SELECT COUNT(*)::int n FROM "${t}" WHERE ${pred}`, [v]);
      if (r.rows[0].n > 0) out[t] = r.rows[0].n;
    }
    const u = await q(`SELECT COUNT(*)::int n FROM users WHERE id::text = ANY($1::text[])`, [userIds]);
    if (u.rows[0].n > 0) out["users"] = u.rows[0].n;
    return out;
  }

  const before = await ownedCounts();
  const beforeTotal = Object.values(before).reduce((a, b) => a + b, 0);
  log(`  ${Object.keys(before).length} tables hold data — ${beforeTotal} rows total\n`);

  // ── STEP 4: call the deletion endpoint ────────────────────────────────────
  log("── STEP 4 — DELETE /api/billing/account");
  const t0 = Date.now();
  const delRes = await fetch(`${BASE}/api/billing/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  const delBody = await delRes.json().catch(() => ({}));
  const elapsed = Date.now() - t0;
  log(`  HTTP ${delRes.status} in ${elapsed}ms`);
  log(`  ${JSON.stringify(delBody)}\n`);
  check(delRes.status === 200, "Deletion endpoint returns 200", `got ${delRes.status}`);

  // ── STEP 5: "after" matrix ────────────────────────────────────────────────
  log("── STEP 5 — Count owned rows AFTER deletion");
  const after = await ownedCounts();
  const afterTotal = Object.values(after).reduce((a, b) => a + b, 0);
  const survivors = Object.entries(after).map(([t, n]) => `${t}(${n})`);
  log(`  ${Object.keys(after).length} tables still hold data — ${afterTotal} rows`);
  if (survivors.length) log(`  survivors: ${survivors.join(", ")}`);
  check(afterTotal === 0, "Zero rows survive across all owned tables", survivors.join(", "));
  log("");

  // ── STEP 6: session must be dead ──────────────────────────────────────────
  log("── STEP 6 — Old session must be rejected");
  const meRes = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  log(`  GET /api/me with revoked token → HTTP ${meRes.status}`);
  check(meRes.status === 401 || meRes.status === 403, "Revoked session returns 401/403", `got ${meRes.status}`);

  const sessRow = await q(`SELECT COUNT(*)::int n FROM user_sessions WHERE token=$1`, [TOKEN]);
  check(sessRow.rows[0].n === 0, "Session row deleted from user_sessions");
  log("");

  // ── STEP 7: idempotency ───────────────────────────────────────────────────
  log("── STEP 7 — Idempotency (second call must not 500)");
  const again = await fetch(`${BASE}/api/billing/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  log(`  second DELETE → HTTP ${again.status}`);
  check(again.status !== 500, "Repeat deletion does not crash", `got ${again.status}`);
  log("");

  // ── STEP 8: full-schema orphan audit ──────────────────────────────────────
  log("── STEP 8 — Full-schema orphan audit");
  const orphans = [];
  for (const [table, cols] of byTable) {
    for (const c of cols) {
      const isOrg = ORG_COLUMNS.includes(c.column_name);
      const isUsr = USER_COLUMNS.includes(c.column_name);
      if (!isOrg && !isUsr) continue;
      const sql = isOrg
        ? `SELECT COUNT(*)::int n FROM "${table}" WHERE "${c.column_name}"::text = $1`
        : `SELECT COUNT(*)::int n FROM "${table}" WHERE "${c.column_name}"::text = ANY($1::text[])`;
      try {
        const r = await q(sql, [isOrg ? ORG_ID : userIds]);
        if (r.rows[0].n > 0) orphans.push({ table, column: c.column_name, count: r.rows[0].n });
      } catch { /* ignore */ }
    }
  }
  log(`  ${orphans.length} orphan reference(s) found`);
  if (orphans.length) for (const o of orphans) log(`    ⚠ ${o.table}.${o.column} = ${o.count}`);
  check(orphans.length === 0, "No orphan org_id/user_id references anywhere in the schema");
  log("");

  // ── Report ────────────────────────────────────────────────────────────────
  const matrix = [];
  for (const t of new Set([...Object.keys(before), ...Object.keys(after)])) {
    matrix.push({ table: t, rowsBefore: before[t] ?? 0, rowsAfter: after[t] ?? 0 });
  }
  matrix.sort((a, b) => b.rowsBefore - a.rowsBefore);

  const report = {
    certifiedAt: new Date().toISOString(),
    orgId: ORG_ID,
    users: { owner: OWNER_MAIL, ownerId: OWNER_ID, memberId: MEMBER_ID },
    endpoint: "DELETE /api/billing/account",
    httpStatus: delRes.status,
    httpBody: delBody,
    durationMs: elapsed,
    tablesWithOwnershipColumn: owned.length,
    tablesSeeded: seeded.length,
    tablesNotSeedable: skipped,
    rowsBefore: beforeTotal,
    rowsAfter: afterTotal,
    matrix,
    orphans,
    sessionRevoked: meRes.status === 401 || meRes.status === 403,
    idempotent: again.status !== 500,
    result: { pass: PASS, fail: FAIL, failures },
  };
  writeFileSync(new URL("./deletion-cert-report.json", import.meta.url), JSON.stringify(report, null, 2));

  log(line);
  log(`  CERTIFICATION: ${PASS} passed, ${FAIL} failed`);
  log(`  ${beforeTotal} rows seeded across ${Object.keys(before).length} tables → ${afterTotal} remaining`);
  log(`  Report: tools/deletion-cert-report.json`);
  log(line + "\n");
  if (FAIL > 0) { log("FAILURES:"); failures.forEach(f => log(`  • ${f}`)); }

  await pool.end();
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nFATAL:", e);
  // Best-effort cleanup so a crashed run does not leave test data behind.
  await q(`DELETE FROM user_sessions WHERE token=$1`, [TOKEN]).catch(() => {});
  await q(`DELETE FROM organization_members WHERE organization_id::text=$1`, [ORG_ID]).catch(() => {});
  await q(`DELETE FROM organizations WHERE id::text=$1`, [ORG_ID]).catch(() => {});
  await q(`DELETE FROM users WHERE id::text = ANY($1::text[])`, [[OWNER_ID, MEMBER_ID]]).catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
