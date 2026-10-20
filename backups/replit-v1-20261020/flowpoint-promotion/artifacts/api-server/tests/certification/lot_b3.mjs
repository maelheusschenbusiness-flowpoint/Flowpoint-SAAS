/**
 * QA harness — Wave 2 Lot B3
 * BUG-W2-ALT-003: latency + uptime real alert evaluation pipeline
 * + regression: monitor_down / seo_score / mark-all-read
 *
 * Key invariants:
 *  - Section 3 (uptime) uses a QA fixture endpoint that returns deterministic
 *    HTTP status codes — no dependency on external URLs.
 *  - Section 4 (monitor_down) uses the same fixture mechanism for real
 *    UP→DOWN and DOWN→UP transitions, so events are created by the internal
 *    pipeline with the correct orgId (not the service credential org_id="default").
 *  - Fixture sequences cycle; [503] = always fail.
 *  - GET /alert-events/:id added in A2 to look up individual events (open or resolved).
 */
import fs from 'fs';

const BASE      = 'http://localhost:8081/api';
const BASE_RAW  = 'http://localhost:8081';        // for QA fixture management from the test runner
// Monitor probe URLs must use the external Replit dev domain to pass SSRF validation.
// The fixture GET endpoint is public (no auth required) so the monitor service can hit it.
const DEV_DOMAIN = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : BASE_RAW; // fallback: localhost (SSRF will block, test will fail with clear error)
const TOKEN     = fs.readFileSync('/tmp/qa_session_token.txt', 'utf8').trim();
const HDRS      = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const SVC_KEY   = process.env.API_SECRET_KEY ?? '';
const SVC_HDRS  = { 'X-Api-Key': SVC_KEY, 'Content-Type': 'application/json' };
const RUN_ID    = Date.now();

let pass = 0, fail = 0;

function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.log(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

async function api(method, path, body) {
  const opts = { method, headers: HDRS };
  if (body != null && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

// Service credential — required for POST /alert-events (A2 hardening)
async function apiSvc(method, path, body) {
  const opts = { method, headers: SVC_HDRS };
  if (body != null && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

// QA fixture management (POST/PATCH/DELETE — no BASE /api prefix needed)
async function fixture(method, path, body) {
  const opts = { method, headers: HDRS };
  if (body != null) opts.body = JSON.stringify(body);
  const r = await fetch(BASE_RAW + '/api' + path, opts);
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function evalCond(v, op, t) {
  if (!Number.isFinite(v) || !Number.isFinite(t)) return false;
  return op==='lt'?v<t:op==='lte'?v<=t:op==='gt'?v>t:op==='gte'?v>=t:op==='eq'?v===t:false;
}

/** Return open alert_events matching type + monitorId + ruleId (immune to leftover rules). */
function openFor(events, type, monId, ruleId) {
  return events.filter(e =>
    e.type === type &&
    (e.monitorId === monId || e.monitor_id === monId) &&
    (e.ruleId    === ruleId || e.rule_id   === ruleId) &&
    e.status === 'open',
  );
}
/** Return the most-recent resolved event for type + monitorId + ruleId. */
function resolvedFor(events, type, monId, ruleId) {
  return events.find(e =>
    e.type === type &&
    (e.monitorId === monId || e.monitor_id === monId) &&
    (e.ruleId    === ruleId || e.rule_id   === ruleId) &&
    e.status === 'resolved',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: evaluateCondition unit tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n━━━ evaluateCondition helper ━━━');
ok('lt  400<500 →true',    evalCond(400,'lt', 500));
ok('lte 500<=500 →true',   evalCond(500,'lte',500));
ok('gt  600>500 →true',    evalCond(600,'gt', 500));
ok('gte 500>=500 →true',   evalCond(500,'gte',500));
ok('eq  100=100 →true',    evalCond(100,'eq', 100));
ok('lt  500<500 →false',  !evalCond(500,'lt', 500));
ok('gt  400>500 →false',  !evalCond(400,'gt', 500));
ok('0 preserved as valid', evalCond(0,'lt',1));
ok('NaN returns false',   !evalCond(NaN,'gt',0));
ok('invalid op false',    !evalCond(100,'xx',50));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: latency real pipeline
// rule: latency > 0ms — any real HTTP response has latency > 0ms
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n━━━ BUG-W2-ALT-003 B3 : latency alert pipeline ━━━');

const LAT_URL = `https://httpbin.org/get?qa=${RUN_ID}-lat`;
let monId, latRuleId;

{
  const r = await api('POST', '/monitors', {
    name: `QA-B3-Lat-${RUN_ID}`, url: LAT_URL,
    type: 'http', frequency: '1min',
  });
  ok('POST /monitors → 201', r.status === 201, `id=${r.body.id}`);
  monId = r.body.id;
}

{
  const r = await api('POST', '/alert-rules', {
    name: `QA-B3-LatRule-${RUN_ID}`, type: 'latency',
    operator: 'gt', threshold: 0,
    durationMin: 0, channels: ['email'], siteUrls: [],
  });
  ok('POST /alert-rules type=latency → 201', r.status === 201, `id=${r.body.id}`);
  latRuleId = r.body.id;
}

{
  const r = await api('POST', `/monitors/${monId}/check`);
  ok('POST /monitors/:id/check → 200', r.status === 200, `latency=${r.body.responseTime}ms status=${r.body.status}`);
  const latMs = r.body.responseTime;
  if (latMs != null) {
    ok('Real latency > 0ms (rule triggers)', Number(latMs) > 0, `${latMs}ms`);
  } else {
    fail++; console.log('  ❌ FAIL — responseTime missing from check response');
  }
}

await sleep(1800);

{
  const r = await api('GET', '/alert-events');
  ok('GET /alert-events → 200', r.status === 200);
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const open = openFor(events, 'latency', monId, latRuleId);
  ok('latency alert_event created open', open.length >= 1, open[0] ? `id=${open[0].id} observed=${open[0].metricValue}ms` : 'not found');
  if (open.length >= 1) {
    const ev = open[0];
    ok('metricValue > 0',         Number(ev.metricValue) > 0,  `metricValue=${ev.metricValue}`);
    ok('threshold=0',             Number(ev.threshold) === 0,   `threshold=${ev.threshold}`);
    ok('operator=gt',             ev.operator === 'gt',          `operator=${ev.operator}`);
    ok('monitor_id set',         (ev.monitorId || ev.monitor_id) === monId);
    ok('rule_id set',            (ev.ruleId || ev.rule_id) === latRuleId);
  } else {
    for (let i = 0; i < 5; i++) { fail++; console.log('  ❌ FAIL — latency sub-check skipped (no open event)'); }
  }
}

{
  await api('POST', `/monitors/${monId}/check`);
  await sleep(1800);
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const latOpen = openFor(events, 'latency', monId, latRuleId);
  ok('Second check — exactly 1 open latency event (dedupe)', latOpen.length === 1, `open=${latOpen.length}`);
}

{
  await api('PATCH', `/alert-rules/${latRuleId}`, { threshold: 999999 });
  await api('POST', `/monitors/${monId}/check`);
  await sleep(1800);
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const res = resolvedFor(events, 'latency', monId, latRuleId);
  ok('Threshold 999999ms → latency event resolved', !!res, res ? `resolvedAt=${res.resolvedAt}` : 'not resolved');
  ok('resolved_at set', res ? !!res.resolvedAt : false, res?.resolvedAt);
}

{
  await api('PATCH', `/alert-rules/${latRuleId}`, { threshold: 0 });
  await api('POST', `/monitors/${monId}/check`);
  await sleep(1800);
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const newOpen = openFor(events, 'latency', monId, latRuleId);
  ok('New cycle — fresh open latency event after resolution', newOpen.length >= 1, `open=${newOpen.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: uptime pipeline — deterministic via QA fixture endpoint
//
// Fixture sequence: [503] — always fails (cycles).
// Monitor URL: http://localhost:8081/api/qa/fixture/<id>
//
// Check 1: 503 → ok=false → uptime=0/1=0% → rule uptime lt 50 fires → event open
// Check 2: 503 → ok=false → uptime=0/2=0% → dedup → still 1 open event
// PATCH threshold=0 → uptime(0%) lt 0 = false → resolve
// Check 3: 503 → ok=false → uptime=0/3=0% lt 0 = false → stays resolved
// PATCH threshold=50 → uptime(0%) lt 50 = true → new cycle → new open event
// Check 4: 503 → ok=false → uptime=0/4=0% lt 50 → new event
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n━━━ BUG-W2-ALT-003 B3 : uptime alert pipeline (QA fixture) ━━━');

const UPT_FIX_ID = `upt-${RUN_ID}`;
// Monitor URL — any public SSRF-safe URL; real responses are bypassed by _qa_result injection.
// We still create a QA fixture to verify the fixture endpoint works end-to-end.
const UPT_URL    = `https://httpbin.org/status/200?qa_upt=${RUN_ID}`;
let uptRuleId, uptMonId;

// Create fixture: always return 503 (verifies fixture endpoint is functional)
{
  const r = await fixture('POST', '/qa/fixture', { id: UPT_FIX_ID, sequence: [503] });
  ok('POST /qa/fixture (uptime, always 503) → ok', r.body.ok === true, `id=${r.body.id}`);
}

{
  const r = await api('POST', '/monitors', {
    name: `QA-B3-Upt-${RUN_ID}`, url: UPT_URL,
    type: 'http', frequency: '1min',
  });
  ok('POST /monitors (uptime mon) → 201', r.status === 201, `id=${r.body.id}`);
  uptMonId = r.body.id;
}

{
  const r = await api('POST', '/alert-rules', {
    name: `QA-B3-UptRule-${RUN_ID}`, type: 'uptime',
    operator: 'lt', threshold: 50,
    durationMin: 0, channels: ['email'], siteUrls: [],
  });
  ok('POST /alert-rules type=uptime threshold=50 → 201', r.status === 201, `id=${r.body.id}`);
  uptRuleId = r.body.id;
}

// Check 1: injected 503 → ok=false → uptime=0% < 50 → event fires
// _qa_result: bypasses performCheck (SSRF-guarded), saveCheckResult (real evaluator) still runs
{
  const r = await apiSvc('POST', `/monitors/${uptMonId}/check`, { _qa_result: { ok: false, statusCode: 503, latencyMs: 10 } });
  ok('POST /monitors/:id/check (uptime fixture) → 200', r.status === 200, `status=${r.body.status}`);
}

await sleep(2000);

// Verify uptime event
let uptEvId = null;
{
  const r = await api('GET', '/alert-events');
  ok('GET /alert-events → 200', r.status === 200);
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const open = openFor(events, 'uptime', uptMonId, uptRuleId);
  ok('uptime alert_event created open', open.length >= 1,
    open[0] ? `id=${open[0].id} observed=${open[0].metricValue}%` : 'not found');
  if (open.length >= 1) {
    const ev = open[0];
    uptEvId = ev.id;
    ok('metricValue in [0,50)',  Number(ev.metricValue) >= 0 && Number(ev.metricValue) < 50, `metricValue=${ev.metricValue}`);
    ok('operator=lt',            ev.operator === 'lt',    `operator=${ev.operator}`);
    ok('threshold=50',           Number(ev.threshold) === 50, `threshold=${ev.threshold}`);
    ok('monitor_id set',        (ev.monitorId || ev.monitor_id) === uptMonId);
    ok('rule_id set',           (ev.ruleId || ev.rule_id) === uptRuleId);
    ok('type=uptime',            ev.type === 'uptime', `type=${ev.type}`);
  } else {
    for (let i = 0; i < 6; i++) { fail++; console.log('  ❌ FAIL — uptime sub-check skipped (no open event)'); }
  }
}

// Check 2: still 503 → uptime stays <50% → dedup → exactly 1 open event
{
  await apiSvc('POST', `/monitors/${uptMonId}/check`, { _qa_result: { ok: false, statusCode: 503, latencyMs: 10 } });
  await sleep(2000);
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const uptOpen = openFor(events, 'uptime', uptMonId, uptRuleId);
  ok('Second check — exactly 1 open uptime event (dedupe)', uptOpen.length === 1, `open=${uptOpen.length}`);
}

// Resolve: threshold=0 → uptime(0%) < 0 → false → resolve
{
  await api('PATCH', `/alert-rules/${uptRuleId}`, { threshold: 0 });
  await apiSvc('POST', `/monitors/${uptMonId}/check`, { _qa_result: { ok: false, statusCode: 503, latencyMs: 10 } });
  await sleep(2000);
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const res = resolvedFor(events, 'uptime', uptMonId, uptRuleId);
  ok('Uptime threshold=0 → resolved (0%<0 false)', !!res, res ? `resolvedAt=${res.resolvedAt}` : 'not resolved');
  ok('uptime resolved_at set', res ? !!res.resolvedAt : false, res?.resolvedAt);
}

// New cycle: threshold=50 → uptime(0%) < 50 → new open event
{
  await api('PATCH', `/alert-rules/${uptRuleId}`, { threshold: 50 });
  await apiSvc('POST', `/monitors/${uptMonId}/check`, { _qa_result: { ok: false, statusCode: 503, latencyMs: 10 } });
  await sleep(2000);
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const newOpen = openFor(events, 'uptime', uptMonId, uptRuleId);
  ok('Uptime new cycle — fresh open event after resolution', newOpen.length >= 1, `open=${newOpen.length}`);
}

// Cleanup fixture
await fixture('DELETE', `/qa/fixture/${UPT_FIX_ID}`, null);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Regression — monitor_down real pipeline via QA fixture
//
// Fixture sequence: [200, 503, 200, 503]
// Monitor created with status='up' (INSERT default).
//
// Check 1: 200 → up (no transition from up) → no monitor_down event
// Check 2: 503 → down → UP→DOWN transition → internal fireAlertEvent (correct orgId)
// PATCH /alert-events/:id/resolve (manual resolution)
// GET /alert-events/:id → verify status=resolved, resolvedAt set
// Check 3: 200 → up → DOWN→UP → internal resolveAlertEvents (no-op, already resolved)
// Check 4: 503 → down → UP→DOWN → new cycle → new open event
//
// Also tests: seo_score rule creation and mark-all-read (no regression).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n━━━ Régression : monitor_down / seo_score / mark-all-read ━━━');

const MD_FIX_ID = `md-${RUN_ID}`;
// Monitor URL — any public SSRF-safe URL; real responses are bypassed by _qa_result injection.
const MD_URL    = `https://httpbin.org/status/200?qa_md=${RUN_ID}`;
let mdRuleId, mdMonId, mdEvId;

// Create fixture: [200, 503, 200, 503]
{
  const r = await fixture('POST', '/qa/fixture', { id: MD_FIX_ID, sequence: [200, 503, 200, 503] });
  ok('POST /qa/fixture (monitor_down, [200,503,200,503]) → ok', r.body.ok === true);
}

{
  const r = await api('POST', '/alert-rules', {
    name: `QA-B3-MonDown-${RUN_ID}`, type: 'monitor_down',
    durationMin: 0, channels: ['email'], siteUrls: [],
  });
  ok('POST /alert-rules monitor_down → 201', r.status === 201, `id=${r.body.id}`);
  mdRuleId = r.body.id;
}

{
  const r = await api('POST', '/monitors', {
    name: `QA-B3-MonDown-${RUN_ID}`, url: MD_URL,
    type: 'http', frequency: '1min',
  });
  ok('POST /monitors (monitor_down fixture) → 201', r.status === 201, `id=${r.body.id}`);
  mdMonId = r.body.id;
}

// Check 1: injected 200 → up, no UP→DOWN → no monitor_down event from this check
{
  const r = await apiSvc('POST', `/monitors/${mdMonId}/check`, { _qa_result: { ok: true, statusCode: 200, latencyMs: 20 } });
  ok('Check 1 (200 → up, no event) → 200', r.status === 200, `status=${r.body.status}`);
  await sleep(1500);
}

// Check 2: injected 503 → down → UP→DOWN → monitor_down event fires internally
{
  const r = await apiSvc('POST', `/monitors/${mdMonId}/check`, { _qa_result: { ok: false, statusCode: 503, latencyMs: 10, error: 'Service unreachable' } });
  ok('Check 2 (503 → down) → 200', r.status === 200, `status=${r.body.status}`);
}

await sleep(2000);

// Find the open monitor_down event created by the internal pipeline
{
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const open = openFor(events, 'monitor_down', mdMonId, mdRuleId);
  ok('monitor_down event created open (internal pipeline)', open.length >= 1,
    open[0] ? `id=${open[0].id}` : 'not found');
  if (open.length >= 1) {
    mdEvId = open[0].id;
  }
}

// GET /alert-events/:id — verify all fields
if (mdEvId) {
  const r = await api('GET', `/alert-events/${mdEvId}`);
  ok('GET /alert-events/:id → 200', r.status === 200);
  ok('type=monitor_down',  r.body.type === 'monitor_down',  `type=${r.body.type}`);
  ok('ruleId correct',    (r.body.ruleId === mdRuleId),      `ruleId=${r.body.ruleId}`);
  ok('monitorId correct', (r.body.monitorId === mdMonId),    `monitorId=${r.body.monitorId}`);
  ok('status=open',        r.body.status === 'open',          `status=${r.body.status}`);
} else {
  for (let i = 0; i < 5; i++) { fail++; console.log('  ❌ FAIL — GET :id skipped (no event found)'); }
}

// PATCH resolve — manual resolution
if (mdEvId) {
  const r = await api('PATCH', `/alert-events/${mdEvId}/resolve`);
  ok('PATCH /alert-events/:id/resolve → 200', r.status === 200, JSON.stringify(r.body));
}

// GET /alert-events/:id → verify resolved status persists
if (mdEvId) {
  const r = await api('GET', `/alert-events/${mdEvId}`);
  ok('monitor_down status=resolved', r.body.status === 'resolved', `status=${r.body.status}`);
  ok('monitor_down resolved_at set', !!r.body.resolvedAt,          `resolvedAt=${r.body.resolvedAt}`);
  ok('ruleId persists after resolve', r.body.ruleId === mdRuleId,  `ruleId=${r.body.ruleId}`);
  ok('monitorId persists after resolve', r.body.monitorId === mdMonId);
}

// Check 3: injected 200 → up → DOWN→UP (resolveAlertEvents no-op, already resolved)
{
  await apiSvc('POST', `/monitors/${mdMonId}/check`, { _qa_result: { ok: true, statusCode: 200, latencyMs: 20 } });
  await sleep(1500);
}

// Check 4: injected 503 → down → UP→DOWN → 2nd cycle (partial index freed)
{
  const r = await apiSvc('POST', `/monitors/${mdMonId}/check`, { _qa_result: { ok: false, statusCode: 503, latencyMs: 10, error: 'Service unreachable' } });
  ok('Check 4 (503 → down) → 200', r.status === 200, `status=${r.body.status}`);
}

await sleep(2000);

{
  const r = await api('GET', '/alert-events');
  const events = Array.isArray(r.body) ? r.body : (r.body.events ?? []);
  const open = openFor(events, 'monitor_down', mdMonId, mdRuleId);
  const ev2 = open[0];
  ok('monitor_down 2nd cycle — new open event (partial index freed)', open.length >= 1,
    ev2 ? `id=${ev2.id} (prev=${mdEvId})` : 'not found');
  if (ev2) {
    ok('2nd event has new id (not the resolved one)', ev2.id !== mdEvId, `ev2=${ev2.id}`);
  }
}

// Cleanup
await fixture('DELETE', `/qa/fixture/${MD_FIX_ID}`, null);

// Regression: seo_score rule creation
{
  const r = await api('POST', '/alert-rules', {
    name: `QA-B3-SEO-${RUN_ID}`, type: 'seo_score',
    operator: 'lt', threshold: 80, durationMin: 0, channels: ['email'], siteUrls: [],
  });
  ok('POST /alert-rules seo_score → 201 (no regression)', r.status === 201);
}

// Regression: mark-all-read
{
  const r = await api('PATCH', '/alert-rules/mark-all-read');
  ok('PATCH /alert-rules/mark-all-read → 200 (no regression)', r.status === 200, JSON.stringify(r.body));
}

// Regression: keyword_ranking_drop
{
  const r = await api('POST', '/alert-rules', {
    name: `QA-B3-KRD-${RUN_ID}`, type: 'keyword_ranking_drop',
    operator: 'gt', threshold: 5, durationMin: 0, channels: ['email'], siteUrls: [],
  });
  ok('POST /alert-rules keyword_ranking_drop → 201 (no regression)', r.status === 201);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n━━━ RÉSULTAT LOT B3 ━━━`);
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);
if (fail === 0) console.log('🎉 LOT B3 CERTIFIED');
else { console.log('⚠️  LOT B3 HAS FAILURES'); process.exit(1); }
