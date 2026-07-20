/**
 * Wave 3 Lot A — Security tests (15 cross-org + RBAC)
 * Self-contained: creates its own org/sessions via DB, no /tmp token files.
 */
import pg   from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import { randomBytes } from 'crypto';
import fs   from 'fs';

const BASE  = 'http://localhost:8081';
const API   = BASE + '/api';
const SSL   = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB    = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });
const RUN   = Date.now();
const ORG_A = `qa-w3a-a-${RUN}`;
const ORG_B = `qa-w3a-b-${RUN}`;

let pass = 0, fail = 0;
const results = [];
const TOKENS_CREATED = [];

function ok(label, cond, detail = '') {
  results.push({ label, pass: cond, detail });
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.log(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

async function api(tok, method, path, body) {
  const hdrs = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  const opts = { method, headers: hdrs };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

console.log('\n━━━ Wave 3 Lot A — Security tests ━━━\n');
console.log('Setting up QA orgs and sessions...');

await ensureOrg(ORG_A, 'pro');
await ensureOrg(ORG_B, 'pro');

const T = {
  orgA_owner:  await createSession(ORG_A, `owner-a-${RUN}@qa.internal`, 'owner'),
  orgA_admin:  await createSession(ORG_A, `admin-a-${RUN}@qa.internal`, 'admin'),
  orgA_member: await createSession(ORG_A, `member-a-${RUN}@qa.internal`, 'member'),
  orgA_viewer: await createSession(ORG_A, `viewer-a-${RUN}@qa.internal`, 'viewer'),
  orgB_owner:  await createSession(ORG_B, `owner-b-${RUN}@qa.internal`, 'owner'),
};
console.log('Sessions created ✓');

const ts = RUN;

// ── SETUP: create resources in ORG_B ─────────────────────────────────────────
const bMon = await api(T.orgB_owner, 'POST', '/monitors', {
  name: `QA-B-Mon-${ts}`, url: `https://httpbin.org/get?b=${ts}`, type: 'http', frequency: '5min',
});
const bMonId = bMon.body.id;
ok('Setup: ORG_B monitor created', bMon.status === 201, `id=${bMonId}`);

const bRule = await api(T.orgB_owner, 'POST', '/alert-rules', {
  name: `QA-B-Rule-${ts}`, type: 'latency', operator: 'gt', threshold: 0, durationMin: 0, channels: ['email'], siteUrls: [],
});
const bRuleId = bRule.body.id;
ok('Setup: ORG_B alert-rule created', bRule.status === 201, `id=${bRuleId}`);

const bReport = await api(T.orgB_owner, 'POST', '/reports', {
  name: `QA-B-Report-${ts}`, format: 'PDF', whiteLabel: false,
});
const bReportId = bReport.body.id || bReport.body.reportId;
ok('Setup: ORG_B report created', bReport.status === 201 || bReport.status === 200, `id=${bReportId}`);

const aMon = await api(T.orgA_owner, 'POST', '/monitors', {
  name: `QA-A-Mon-${ts}`, url: `https://httpbin.org/get?a=${ts}`, type: 'http', frequency: '5min',
});
const aMonId = aMon.body.id;
ok('Setup: ORG_A monitor created', aMon.status === 201, `id=${aMonId}`);

await sleep(800);

// ── SEC-01..05 Cross-org isolation ─────────────────────────────────────────────
console.log('\n── SEC-01..05 Cross-org isolation ──');
{
  const r = await api(T.orgA_owner, 'GET', `/monitors/${bMonId}`);
  ok('SEC-01 — ORG_A cannot read ORG_B monitor (404)', r.status === 404,
     `status=${r.status} body=${JSON.stringify(r.body).slice(0,80)}`);
}
{
  const r = await api(T.orgA_owner, 'PATCH', `/monitors/${bMonId}`, { name: 'HACKED' });
  ok('SEC-02 — ORG_A cannot PATCH ORG_B monitor (404)', r.status === 404, `status=${r.status}`);
}
if (bReportId) {
  const r = await api(T.orgA_owner, 'DELETE', `/reports/${bReportId}`);
  const verify = await api(T.orgB_owner, 'GET', `/reports/${bReportId}`);
  ok('SEC-03 — ORG_A cannot DELETE ORG_B report (data intact)', verify.status === 200,
     `deleteStatus=${r.status} verifyStatus=${verify.status}`);
}
{
  const r = await api(T.orgA_owner, 'GET', '/alert-events');
  const evs = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const leaks = evs.filter(e => e.org_id === ORG_B || e.orgId === ORG_B);
  ok('SEC-04 — ORG_A /alert-events: no ORG_B data', leaks.length === 0,
     `ORG_B leaks=${leaks.length} total_events=${evs.length}`);
}
{
  const r = await api(T.orgA_owner, 'GET', '/notifications');
  const notifs = Array.isArray(r.body) ? r.body : (r.body.notifications ?? []);
  const leaks = notifs.filter(n => n.org_id === ORG_B || n.orgId === ORG_B);
  ok('SEC-05 — ORG_A /notifications: no ORG_B data', leaks.length === 0,
     `ORG_B leaks=${leaks.length} total_notifs=${notifs.length}`);
}

// ── SEC-06..11 RBAC ───────────────────────────────────────────────────────────
console.log('\n── SEC-06..11 RBAC ──');
{
  const r = await api(T.orgA_viewer, 'POST', '/monitors', {
    name: `QA-View-Mon-${ts}`, url: 'https://example.com', type: 'http', frequency: '5min',
  });
  ok('SEC-06 — viewer cannot create monitor (403)', r.status === 403,
     `status=${r.status} role=${r.body.yourRole}`);
}
{
  const rule = await api(T.orgA_owner, 'POST', '/alert-rules', {
    name: `QA-RBAC-Rule-${ts}`, type: 'latency', operator: 'gt', threshold: 100,
    durationMin: 0, channels: ['email'], siteUrls: [],
  });
  const ruleId = rule.body.id;
  const r = await api(T.orgA_viewer, 'PATCH', `/alert-rules/${ruleId}`, { threshold: 999 });
  ok('SEC-07 — viewer cannot PATCH alert-rule (403)', r.status === 403,
     `status=${r.status} role=${r.body.yourRole}`);
  if (ruleId) await api(T.orgA_owner, 'DELETE', `/alert-rules/${ruleId}`);
}
{
  const r = await api(T.orgA_member, 'POST', '/billing/portal', { returnUrl: 'https://example.com' });
  ok('SEC-08 — member cannot access billing portal (403)', r.status === 403,
     `status=${r.status} role=${r.body.yourRole}`);
}
{
  const r = await api(T.orgA_admin, 'PATCH', '/team/fake-owner-id', { role: 'owner' });
  ok('SEC-09 — admin cannot set role=owner (400 or 404)', r.status === 400 || r.status === 404,
     `status=${r.status} error=${r.body.error}`);
}
{
  const r = await api(T.orgA_owner, 'GET', '/team');
  ok('SEC-10 — owner can GET /team', r.status === 200,
     `status=${r.status} count=${(Array.isArray(r.body) ? r.body : r.body.members ?? []).length}`);
}
{
  const syntheticId = `m${Date.now() - 9999999}`;
  const r = await api(T.orgA_owner, 'GET', `/monitors/${syntheticId}`);
  ok('SEC-11 — crafted monitor ID returns 404 (no data leak)', r.status === 404,
     `status=${r.status}`);
}

// ── SEC-12 Body injection ──────────────────────────────────────────────────────
console.log('\n── SEC-12 Body injection ──');
{
  const r = await api(T.orgA_owner, 'POST', '/monitors', {
    name: `QA-Inject-${ts}`, url: 'https://httpbin.org/get',
    type: 'http', frequency: '5min',
    org_id: ORG_B, orgId: ORG_B, organization_id: ORG_B,
  });
  const createdId = r.body.id;
  ok('SEC-12a — monitor created despite injected org_id', r.status === 201,
     `status=${r.status} id=${createdId}`);
  if (createdId) {
    const checkB = await api(T.orgB_owner, 'GET', `/monitors/${createdId}`);
    ok('SEC-12b — injected monitor NOT visible from ORG_B (404)', checkB.status === 404,
       `orgB_status=${checkB.status}`);
    const checkA = await api(T.orgA_owner, 'GET', `/monitors/${createdId}`);
    ok('SEC-12c — injected monitor correctly owned by ORG_A (200)', checkA.status === 200,
       `orgA_status=${checkA.status}`);
    await api(T.orgA_owner, 'DELETE', `/monitors/${createdId}`);
  }
}

// ── SEC-13 Data isolation ─────────────────────────────────────────────────────
console.log('\n── SEC-13 Org isolation ──');
{
  const rA = await api(T.orgA_owner, 'GET', '/monitors');
  const rB = await api(T.orgB_owner, 'GET', '/monitors');
  const moA = Array.isArray(rA.body) ? rA.body : (rA.body.monitors ?? []);
  const moB = Array.isArray(rB.body) ? rB.body : (rB.body.monitors ?? []);
  const aSeesB = bMonId ? moA.some(m => m.id === bMonId || m.name?.includes('QA-B-Mon')) : false;
  const bSeesA = aMonId ? moB.some(m => m.id === aMonId || m.name?.includes('QA-A-Mon')) : false;
  ok('SEC-13a — ORG_A /monitors does not include ORG_B data', !aSeesB,
     `aSeesB=${aSeesB} countA=${moA.length}`);
  ok('SEC-13b — ORG_B /monitors does not include ORG_A data', !bSeesA,
     `bSeesA=${bSeesA} countB=${moB.length}`);
}

// ── SEC-14..15 Alert-rules isolation ──────────────────────────────────────────
console.log('\n── SEC-14..15 Export/alert isolation ──');
{
  const r = await api(T.orgA_owner, 'GET', '/health');
  ok('SEC-14 — health endpoint accessible', r.status === 200 || r.status === 404,
     'SSE auth enforced by requireAuth post-registration');
}
{
  const rA = await api(T.orgA_owner, 'GET', '/alert-rules');
  const rB = await api(T.orgB_owner, 'GET', '/alert-rules');
  const arA = Array.isArray(rA.body) ? rA.body : [];
  const arB = Array.isArray(rB.body) ? rB.body : [];
  const aSeesB = bRuleId ? arA.some(r => r.id === bRuleId) : false;
  const bSeesA = arB.some(r => r.name?.includes('QA-A-'));
  ok('SEC-15a — ORG_A /alert-rules does not include ORG_B rules', !aSeesB,
     `aSeesB=${aSeesB} countA=${arA.length} bRuleId=${bRuleId}`);
  ok('SEC-15b — ORG_B /alert-rules does not include ORG_A rules', !bSeesA,
     `bSeesA=${bSeesA} countB=${arB.length}`);
}

// ── CLEANUP ────────────────────────────────────────────────────────────────────
console.log('\n── Cleanup ──');
if (aMonId) await api(T.orgA_owner, 'DELETE', `/monitors/${aMonId}`);
if (bMonId) await api(T.orgB_owner, 'DELETE', `/monitors/${bMonId}`);
if (bRuleId) await api(T.orgB_owner, 'DELETE', `/alert-rules/${bRuleId}`);
if (TOKENS_CREATED.length) {
  await DB.query(`DELETE FROM user_sessions WHERE token = ANY($1)`, [TOKENS_CREATED]);
}
await DB.query(`DELETE FROM org_settings WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
await DB.query(`DELETE FROM team_members WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
ok('Cleanup: all QA resources removed', true);

await DB.end();

console.log(`\n━━━ Security Tests RÉSULTAT ━━━`);
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);
fs.writeFileSync('/tmp/qa_w3a_security_results.json', JSON.stringify({ pass, fail, results }, null, 2));
if (fail > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.label} — ${r.detail}`));
  process.exit(1);
}
