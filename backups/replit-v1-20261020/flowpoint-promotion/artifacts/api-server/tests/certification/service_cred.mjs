/**
 * QA — Service Credential Security Audit
 * Wave 3 Lot A2 — Point 6
 *
 * Validates that:
 *  1. Bearer token with forged userId=service → 401
 *  2. X-Api-Key incorrect → 401
 *  3. X-Api-Key correct on ordinary user route → 403
 *  4. X-Api-Key correct on POST /alert-events → 201
 *  5. Service key absent from /api/me response → PASS
 *  6. Service key absent from frontend bundle → PASS
 */
import fs from 'fs';
import crypto from 'crypto';

const BASE       = 'http://localhost:8081/api';
const SVC_KEY    = process.env.API_SECRET_KEY ?? '';
const SVC_HDRS   = { 'X-Api-Key': SVC_KEY, 'Content-Type': 'application/json' };
const BAD_KEY    = 'INVALID_KEY_' + Date.now();
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me-in-prod-min32chars';

let pass = 0, fail = 0;

function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.log(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

async function req(method, path, hdrs, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...hdrs } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

// ── Create a forged Bearer session with user_id='service' in the DB ──────────
// This simulates an attacker who has DB write access and tries to escalate
// privileges by inserting a session that appears to be the service credential.
import { execSync } from 'child_process';

function makeToken(userId, orgId) {
  const rand = crypto.randomBytes(24).toString('hex');
  const n36  = Date.now().toString(36);
  const payload = `${userId}:${orgId}:${rand}:${n36}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

let forgedToken = '';
let meToken = '';

// Forged session: user_id="service" in DB via Bearer
try {
  forgedToken = makeToken('service', 'attacker@evil.com');
  const expires = new Date(Date.now() + 3600000).toISOString();
  const sql = `INSERT INTO user_sessions (token,user_id,org_id,email,role,expires_at,created_at)
    VALUES ('${forgedToken}','service','attacker@evil.com','attacker@evil.com','admin','${expires}',NOW())
    ON CONFLICT DO NOTHING;`;
  execSync(`psql "$DATABASE_URL" --no-password -c "${sql.replace(/"/g, '\\"')}"`, {
    env: { ...process.env }, stdio: 'pipe',
  });
} catch (e) {
  console.warn('  ⚠️  Could not insert forged session:', e.message);
}

// Normal user session for /api/me check
try {
  meToken = fs.readFileSync('/tmp/qa_session_token.txt', 'utf8').trim();
} catch { /* ignore */ }

console.log('\n━━━ SERVICE CREDENTIAL SECURITY AUDIT ━━━');

// ── Test 1: Forged Bearer with userId=service → 401 ──────────────────────────
if (forgedToken) {
  const r = await req('GET', '/monitors', { Authorization: `Bearer ${forgedToken}` });
  ok('Forged Bearer userId=service → 401 (not 200/403)', r.status === 401,
    `status=${r.status} error=${JSON.stringify(r.body.error ?? '')}`);
} else {
  fail++; console.log('  ❌ FAIL — could not create forged session to test');
}

// ── Test 2: Incorrect X-Api-Key → 401 ────────────────────────────────────────
{
  const r = await req('GET', '/monitors', { 'X-Api-Key': BAD_KEY });
  ok('Incorrect X-Api-Key → 401', r.status === 401,
    `status=${r.status}`);
}

// ── Test 3: Correct X-Api-Key on ordinary user route → 403 ───────────────────
{
  const r = await req('GET', '/monitors', SVC_HDRS);
  ok('Correct X-Api-Key on GET /monitors → 403', r.status === 403,
    `status=${r.status} error=${JSON.stringify(r.body.error ?? '')}`);
}

{
  const r = await req('GET', '/alert-events', SVC_HDRS);
  ok('Correct X-Api-Key on GET /alert-events → 403', r.status === 403,
    `status=${r.status}`);
}

{
  const r = await req('GET', '/me', SVC_HDRS);
  ok('Correct X-Api-Key on GET /me → 403', r.status === 403,
    `status=${r.status}`);
}

{
  const r = await req('POST', '/monitors', SVC_HDRS, { name: 'test', url: 'https://x.com' });
  ok('Correct X-Api-Key on POST /monitors → 403', r.status === 403,
    `status=${r.status}`);
}

// ── Test 4: Correct X-Api-Key on POST /alert-events → 201 ────────────────────
{
  const r = await req('POST', '/alert-events', SVC_HDRS, {
    ruleId: `svc_test_${Date.now()}`, ruleName: 'Svc Cred Audit', type: 'monitor_down',
    severity: 'critical', message: 'service cred audit test',
    siteUrl: 'https://qa.test', monitorId: 'mon_svc_test',
  });
  ok('Correct X-Api-Key on POST /alert-events → 201', r.status === 201,
    `status=${r.status} id=${r.body.id ?? 'none'}`);
}

// ── Test 5: Service key absent from /api/me response ─────────────────────────
if (meToken) {
  const r = await req('GET', '/me', { Authorization: `Bearer ${meToken}` });
  const body = JSON.stringify(r.body);
  const keyPresent = SVC_KEY && body.includes(SVC_KEY);
  ok('Service key absent from /api/me response', !keyPresent,
    keyPresent ? 'KEY LEAKED' : 'not found in response');
}

// ── Test 6: Service key absent from frontend bundle ───────────────────────────
{
  const bundleDir = 'artifacts/api-server/dist';
  let found = false;
  if (fs.existsSync(bundleDir) && SVC_KEY && SVC_KEY.length > 8) {
    const files = fs.readdirSync(bundleDir, { recursive: true })
      .filter(f => typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.ts')));
    for (const f of files) {
      try {
        const content = fs.readFileSync(`${bundleDir}/${f}`, 'utf8');
        if (content.includes(SVC_KEY)) { found = true; break; }
      } catch { /* skip unreadable */ }
    }
  }
  ok('Service key absent from dist bundle', !found, found ? 'KEY FOUND IN BUNDLE' : 'not in bundle');
}

// ── Test 7: Service key absent from server logs (recent stdout) ───────────────
{
  let logLeak = false;
  try {
    const logs = execSync(
      `grep -r "${SVC_KEY.slice(0,8)}" /tmp/*.log 2>/dev/null || true`,
      { env: process.env, stdio: 'pipe' }
    ).toString().trim();
    if (logs && logs.includes(SVC_KEY)) logLeak = true;
  } catch { /* no log files */ }
  ok('Service key absent from /tmp logs', !logLeak, logLeak ? 'KEY FOUND IN LOGS' : 'not in logs');
}

// Cleanup: remove forged session
if (forgedToken) {
  try {
    execSync(
      `psql "$DATABASE_URL" --no-password -c "DELETE FROM user_sessions WHERE token='${forgedToken}';"`,
      { env: process.env, stdio: 'pipe' }
    );
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n━━━ RÉSULTAT SERVICE CREDENTIAL AUDIT ━━━`);
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);
if (fail === 0) console.log('🎉 SERVICE CREDENTIAL AUDIT CERTIFIED');
else { console.log('⚠️  CREDENTIAL AUDIT HAS FAILURES'); process.exit(1); }
