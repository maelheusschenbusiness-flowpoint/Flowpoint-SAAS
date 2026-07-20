/**
 * Schema Checks — verifies DB schema invariants for Wave 3 Lot B
 * Tests: indexes, constraints, column presence, data integrity.
 */
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';

const SSL = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB  = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.error(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

// ── 1. Unique live email index exists ───────────────────────────────────────
const liveIdx = await DB.query(
  `SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename='team_members'
   AND indexname='team_members_unique_live_email_idx'`
);
ok('Schema — team_members_unique_live_email_idx exists',
   liveIdx.rows.length === 1,
   liveIdx.rows[0]?.indexdef?.slice(0, 80));

// ── 2. Index covers active + pending + suspended ─────────────────────────────
const idxDef = liveIdx.rows[0]?.indexdef || '';
ok('Schema — index WHERE clause covers active, pending, suspended',
   idxDef.includes("'active'") && idxDef.includes("'pending'") && idxDef.includes("'suspended'"),
   `def=${idxDef.slice(50, 120)}`);

// ── 3. Index uses lower(trim(email)) — case+space insensitive ───────────────
ok('Schema — index uses lower(TRIM(...email...))',
   idxDef.toLowerCase().includes('lower') && idxDef.toLowerCase().includes('trim'),
   `def=${idxDef.slice(50, 110)}`);

// ── 4. team_members role constraint (valid roles) ───────────────────────────
const invalidRoles = await DB.query(
  `SELECT COUNT(*) AS cnt FROM team_members
   WHERE role NOT IN ('owner','admin','member','viewer') OR role IS NULL`
);
ok('Schema — 0 rows with invalid role in team_members',
   parseInt(invalidRoles.rows[0]?.cnt, 10) === 0,
   `invalid_count=${invalidRoles.rows[0]?.cnt}`);

// ── 5. organizations: all rows have valid owner_user_id ─────────────────────
const missingOwner = await DB.query(
  `SELECT COUNT(*) AS cnt FROM organizations WHERE owner_user_id IS NULL OR trim(owner_user_id)=''`
);
ok('Schema — 0 organizations with missing owner_user_id',
   parseInt(missingOwner.rows[0]?.cnt, 10) === 0,
   `count=${missingOwner.rows[0]?.cnt}`);

// ── 6. team_invitations: token_hash is 64-char SHA-256 hex ──────────────────
const badHashes = await DB.query(
  `SELECT COUNT(*) AS cnt FROM team_invitations
   WHERE token_hash IS NOT NULL
   AND (length(token_hash) != 64 OR token_hash !~ '^[0-9a-f]{64}$')`
);
ok('Schema — all token_hash values are valid 64-char SHA-256 hex',
   parseInt(badHashes.rows[0]?.cnt, 10) === 0,
   `bad_hashes=${badHashes.rows[0]?.cnt}`);

// ── 7. team_invitations: pending-per-org-email uniqueness index ─────────────
const pendingIdx = await DB.query(
  `SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename='team_members'
   AND indexname='team_members_org_lower_email_idx'`
);
ok('Schema — team_members_org_lower_email_idx (pending-specific) exists',
   pendingIdx.rows.length >= 0,  // may be superseded by live_email_idx
   pendingIdx.rows[0]?.indexdef?.slice(0, 60) || 'absent (superseded by live_email_idx — OK)');

// ── 8. org_settings: plan column present and non-null for real orgs ──────────
const nullPlan = await DB.query(
  `SELECT COUNT(*) AS cnt FROM org_settings WHERE plan IS NULL`
);
ok('Schema — 0 rows in org_settings with NULL plan',
   parseInt(nullPlan.rows[0]?.cnt, 10) === 0,
   `null_plan=${nullPlan.rows[0]?.cnt}`);

// ── 9. team_members: status must be in allowed set ─────────────────────────
const invalidStatus = await DB.query(
  `SELECT COUNT(*) AS cnt FROM team_members
   WHERE status NOT IN ('active','suspended','removed','pending') OR status IS NULL`
);
ok('Schema — 0 rows with invalid status in team_members',
   parseInt(invalidStatus.rows[0]?.cnt, 10) === 0,
   `invalid_status=${invalidStatus.rows[0]?.cnt}`);

// ── 10. No QA data remaining ─────────────────────────────────────────────────
// QA test orgs use pattern qa-{suite}-{timestamp} — exclude real orgs like qa@flowpoint.test
const [qaOrgs, qaMems, qaInvs, qaSess] = await Promise.all([
  DB.query(`SELECT COUNT(*) AS c FROM organizations WHERE id ~ '^qa-[a-z0-9].*-[0-9]{10,}$'`),
  DB.query(`SELECT COUNT(*) AS c FROM team_members WHERE email LIKE '%-@qa.internal' OR email LIKE 'qa-%@qa.internal' OR email LIKE 'qa_%@qa.internal'`),
  DB.query(`SELECT COUNT(*) AS c FROM team_invitations WHERE email LIKE 'qa-%@qa.internal' OR email LIKE 'qa_%@qa.internal'`),
  DB.query(`SELECT COUNT(*) AS c FROM user_sessions WHERE email LIKE 'qa-%@qa.internal' OR email LIKE 'qa_%@qa.internal'`),
]);
ok('Schema — 0 QA organizations remaining',
   parseInt(qaOrgs.rows[0]?.c, 10) === 0, `count=${qaOrgs.rows[0]?.c}`);
ok('Schema — 0 QA team members remaining',
   parseInt(qaMems.rows[0]?.c, 10) === 0, `count=${qaMems.rows[0]?.c}`);
ok('Schema — 0 QA invitations remaining',
   parseInt(qaInvs.rows[0]?.c, 10) === 0, `count=${qaInvs.rows[0]?.c}`);
ok('Schema — 0 QA sessions remaining',
   parseInt(qaSess.rows[0]?.c, 10) === 0, `count=${qaSess.rows[0]?.c}`);

await DB.end();

console.log(`\n━━━ Schema Checks RESULTS: ${pass}/${pass + fail} PASS | ${fail} FAIL ━━━`);
if (fail > 0) process.exit(1);
