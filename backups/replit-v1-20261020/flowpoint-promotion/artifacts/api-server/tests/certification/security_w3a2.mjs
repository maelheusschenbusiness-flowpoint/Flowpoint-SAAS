/**
 * Wave 3 Lot A2 — Security tests (20 scenarios)
 * Self-contained: creates its own org/sessions via DB, no /tmp token files.
 * Tests: RBAC write routes, alert-events service-only, cross-tenant 404,
 *        ENABLE_DEV_AUTH hardening, team_members constraints.
 */
import pg   from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import { randomBytes } from 'crypto';
import fs   from 'fs';

const BASE    = 'http://localhost:8081';
const API     = BASE + '/api';
const SSL     = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB      = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });
const RUN     = Date.now();
const ORG_A   = `qa-w3a2-a-${RUN}`;
const ORG_B   = `qa-w3a2-b-${RUN}`;
const SVC_KEY = process.env.API_SECRET_KEY ?? '';

let pass = 0, fail = 0;
const results = [];
const TOKENS_CREATED = [];

function ok(label, cond, detail = '') {
  results.push({ label, pass: cond, detail });
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.log(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

async function api(tok, method, path, body, extraHeaders = {}) {
  const hdrs = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...extraHeaders };
  const opts = { method, headers: hdrs };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function svc(method, path, body) {
  const opts = { method, headers: { 'X-Api-Key': SVC_KEY, 'Content-Type': 'application/json' } };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function anon(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

// ── SELF-CONTAINED SETUP ──────────────────────────────────────────────────────
async function ensureOrg(orgId, plan = 'pro') {
  await DB.query(
    `INSERT INTO org_settings (org_id, plan) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET plan = EXCLUDED.plan`,
    [orgId, plan]
  );
  await DB.query(`
    INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, created_at, updated_at)
    VALUES ($1,$1,$1,$1,'active',$2,NOW(),NOW()) ON CONFLICT (id) DO NOTHING
  `, [orgId, plan]);
}

async function createSession(orgId, email, role) {
  const token = randomBytes(32).toString('hex');
  TOKENS_CREATED.push(token);
  await DB.query(`
    INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at)
    VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '2 hours') ON CONFLICT (token) DO NOTHING
  `, [token, email, orgId, email, role]);
  const mid = `${orgId}-${role}-${RUN}`.slice(0, 80);
  await DB.query(`
    INSERT INTO team_members (id,org_id,email,name,role,joined,status,user_id,invited_at,email_status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,CURRENT_DATE::text,'active',$3,NOW(),'sent',NOW(),NOW()) ON CONFLICT (id) DO NOTHING
  `, [mid, orgId, email, role, role]);
  return token;
}

console.log('\n━━━ Wave 3 Lot A2 — Security tests (20 scenarios) ━━━\n');
console.log('Setting up QA orgs and sessions...');

await ensureOrg(ORG_A, 'pro');
await ensureOrg(ORG_B, 'pro');

const T = {
  orgA_owner:  await createSession(ORG_A, `owner-a2-${RUN}@qa.internal`, 'owner'),
  orgA_admin:  await createSession(ORG_A, `admin-a2-${RUN}@qa.internal`, 'admin'),
  orgA_member: await createSession(ORG_A, `member-a2-${RUN}@qa.internal`, 'member'),
  orgA_viewer: await createSession(ORG_A, `viewer-a2-${RUN}@qa.internal`, 'viewer'),
  orgB_owner:  await createSession(ORG_B, `owner-b2-${RUN}@qa.internal`, 'owner'),
};
console.log('Sessions created ✓');

const ts = RUN;

// ── A2-01..04: POST /alert-events is blocked for all user sessions ────────────
console.log('── A2-01..04 POST /alert-events → 404 for all user sessions ──');
{
  const payload = { ruleId: 'test', ruleName: 'QA', type: 'seo_score', severity: 'warning', message: 'test' };
  for (const [role, tok] of [
    ['owner', T.orgA_owner], ['admin', T.orgA_admin],
    ['member', T.orgA_member], ['viewer', T.orgA_viewer],
  ]) {
    const r = await api(tok, 'POST', '/alert-events', payload);
    ok(`A2-01 — POST /alert-events blocked for ${role} (404)`, r.status === 404,
       `status=${r.status}`);
  }
}

// ── A2-05: POST /alert-events succeeds for service credential ────────────────
console.log('\n── A2-05 POST /alert-events allowed for service role ──');
{
  const r = await svc('POST', '/alert-events', {
    ruleId: `qa-rule-${ts}`, ruleName: 'QA-SVC', type: 'seo_score',
    severity: 'warning', message: 'QA service test', metricValue: 10, threshold: 80, operator: 'lt',
  });
  ok('A2-05 — POST /alert-events succeeds for service (2xx)', r.status < 300,
     `status=${r.status}`);
}

// ── A2-06..07: canWrite blocks viewer ────────────────────────────────────────
console.log('\n── A2-06..07 canWrite blocks viewer on write routes ──');
{
  const r = await api(T.orgA_viewer, 'POST', '/monitors', {
    name: `QA-viewer-${ts}`, url: 'https://example.com', type: 'http', frequency: '5min',
  });
  ok('A2-06 — viewer cannot POST /monitors (403)', r.status === 403, `status=${r.status}`);
}
{
  const r = await api(T.orgA_viewer, 'PATCH', '/alert-rules/mark-all-read', {});
  ok('A2-07 — viewer cannot PATCH /alert-rules/mark-all-read (403)', r.status === 403, `status=${r.status}`);
}

// ── A2-08..09: canAdmin blocks member ────────────────────────────────────────
console.log('\n── A2-08..09 canAdmin blocks member on admin-only routes ──');
{
  const r = await api(T.orgA_member, 'POST', '/notifications', {
    type: 'info', title: 'QA Test', message: 'Should be blocked',
  });
  ok('A2-08 — member cannot POST /notifications (403)', r.status === 403, `status=${r.status}`);
}
{
  const r = await api(T.orgA_member, 'DELETE', '/monitors/fake-id-123', {});
  ok('A2-09 — member cannot DELETE /monitors (403)', r.status === 403, `status=${r.status}`);
}

// ── A2-10: member CAN POST (canWrite) on missions ────────────────────────────
console.log('\n── A2-10 canWrite allows member on missions ──');
{
  const r = await api(T.orgA_member, 'POST', '/missions/from-template', {
    templateTitle: `QA-tpl-${ts}`, category: 'SEO Technique', priority: 'medium',
  });
  ok('A2-10 — member can POST /missions/from-template (200/201/409)', [200, 201, 409].includes(r.status),
     `status=${r.status}`);
  if (r.body?.id) await api(T.orgA_owner, 'DELETE', `/missions/${r.body.id}`);
}

// ── A2-11..13: cross-tenant DELETE returns 404 ────────────────────────────────
console.log('\n── A2-11..13 Cross-tenant DELETE → 404 ──');

const bComp = await api(T.orgB_owner, 'POST', '/competitors', {
  url: `https://qa-competitor-${ts}.com`, name: `QA-B-Comp-${ts}`,
});
const bCompId = bComp.body.id;
ok('Setup: ORG_B competitor created', !!bCompId, `id=${bCompId} status=${bComp.status}`);

if (bCompId) {
  const r = await api(T.orgA_owner, 'DELETE', `/competitors/${bCompId}`);
  ok('A2-11 — ORG_A cannot DELETE ORG_B competitor (404)', r.status === 404,
     `status=${r.status} body=${JSON.stringify(r.body).slice(0,60)}`);
  const own = await api(T.orgB_owner, 'DELETE', `/competitors/${bCompId}`);
  ok('A2-12 — ORG_B can DELETE own competitor (200)', own.status === 200,
     `status=${own.status}`);
}

const aReport = await api(T.orgA_owner, 'POST', '/reports', {
  name: `QA-A2-Report-${ts}`, format: 'PDF', whiteLabel: false,
});
const aReportId = aReport.body.id || aReport.body.reportId;
if (aReportId) {
  const r = await api(T.orgB_owner, 'DELETE', `/reports/${aReportId}`);
  ok('A2-13 — ORG_B cannot DELETE ORG_A report (404)', r.status === 404,
     `status=${r.status}`);
  await api(T.orgA_owner, 'DELETE', `/reports/${aReportId}`);
}

// ── A2-14: ENABLE_DEV_AUTH not set → dev-session returns 404 ─────────────────
console.log('\n── A2-14..15 ENABLE_DEV_AUTH hardening ──');
{
  const r = await anon('POST', '/auth/dev-session', {});
  ok('A2-14 — POST /auth/dev-session without ENABLE_DEV_AUTH → 404',
     r.status === 404, `status=${r.status}`);
}
{
  const r = await fetch(API + '/auth/dev-login');
  ok('A2-15 — GET /auth/dev-login without ENABLE_DEV_AUTH → 404',
     r.status === 404, `status=${r.status}`);
}

// ── A2-16: team_members role CHECK constraint enforced ───────────────────────
console.log('\n── A2-16 team_members role CHECK constraint ──');
{
  const r = await api(T.orgA_owner, 'POST', '/team/invite', {
    email: `qa-bad-role-${ts}@test.com`, name: 'QA Bad', role: 'superadmin',
  });
  ok('A2-16 — invalid role "superadmin" rejected by team invite (not 201)',
     r.status !== 201, `status=${r.status} body=${JSON.stringify(r.body).slice(0,80)}`);
}

// ── A2-17: viewer cannot POST /activity (canAdmin) ───────────────────────────
console.log('\n── A2-17..20 Remaining RBAC checks ──');
{
  const r = await api(T.orgA_viewer, 'POST', '/activity', { type: 'audit', label: 'test' });
  ok('A2-17 — viewer cannot POST /activity (403)', r.status === 403, `status=${r.status}`);
}
{
  const r = await api(T.orgA_viewer, 'POST', '/cro/generate', { siteUrl: 'https://example.com' });
  ok('A2-18 — viewer cannot POST /cro/generate (403)', r.status === 403, `status=${r.status}`);
}
{
  const r = await api(T.orgA_viewer, 'POST', '/review-intelligence/analyze', {
    reviewText: 'Great service', rating: 5,
  });
  ok('A2-19 — viewer cannot POST /review-intelligence/analyze (403)', r.status === 403, `status=${r.status}`);
}
{
  const r = await api(T.orgA_viewer, 'POST', '/local-maps/heatmaps', {
    name: 'QA Heatmap', keyword: 'test', centerLat: 48.8, centerLng: 2.3,
  });
  ok('A2-20 — viewer cannot POST /local-maps/heatmaps (403)', r.status === 403, `status=${r.status}`);
}

// ── CLEANUP ────────────────────────────────────────────────────────────────────
if (TOKENS_CREATED.length) {
  await DB.query(`DELETE FROM user_sessions WHERE token = ANY($1)`, [TOKENS_CREATED]);
}
await DB.query(`DELETE FROM org_settings WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
await DB.query(`DELETE FROM team_members WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
await DB.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[ORG_A, ORG_B]]);
await DB.end();

// ── SUMMARY ───────────────────────────────────────────────────────────────────
console.log(`\n━━━ Wave 3 Lot A2 — RÉSULTAT ━━━`);
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);

fs.writeFileSync('/tmp/qa_w3a2_results.json', JSON.stringify({ pass, fail, results }, null, 2));
if (fail > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.label} — ${r.detail}`));
  process.exit(1);
}
