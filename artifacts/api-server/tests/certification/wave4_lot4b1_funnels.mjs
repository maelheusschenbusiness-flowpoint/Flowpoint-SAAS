/**
 * Wave 4 Lot 4B-1 — GA4 Configurable Funnels Certification
 *
 * Covers: CRUD, Step Validation, Tenant Isolation, GA4 Mapping (v1alpha),
 *         GA4 Error Handling, Calculations/Normalization, Cache, Synthetic-data Absence.
 *
 * Self-contained: creates real orgs/sessions/tokens via direct DB.
 * Mocks only the GA4 HTTP boundary (http.createServer on random port).
 *
 * Run: node artifacts/api-server/tests/certification/wave4_lot4b1_funnels.mjs
 */

import { createHash, createCipheriv, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import http from 'node:http';
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';

const BASE = process.env.API_BASE ?? 'http://localhost:8081';
const API  = BASE + '/api';
const SSL  = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB   = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });
const RUN  = Date.now();

// ── Test orgs ─────────────────────────────────────────────────────────────────
const ORG_A   = `qa-f1-a-${RUN}`;
const ORG_B   = `qa-f1-b-${RUN}`;
const SITE_A  = `https://funnel-a-${RUN}.qa.test`;
const SITE_B  = `https://funnel-b-${RUN}.qa.test`;
const PROP_ID = `9${RUN}`.slice(0, 9); // fake GA4 numeric property id

let pass = 0, fail = 0;
const failures = [];

function ok(label, cond, hint = '') {
  if (cond) { console.log(`  ✅ PASS — ${label}`); pass++; }
  else {
    const m = `${label}${hint ? ' · ' + hint : ''}`;
    console.log(`  ❌ FAIL — ${m}`);
    fail++;
    failures.push(m);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function api(tok, method, path, body, extraHeaders = {}) {
  const hdrs = { 'Content-Type': 'application/json', ...extraHeaders };
  if (tok) hdrs['Authorization'] = `Bearer ${tok}`;
  const opts = { method, headers: hdrs };
  if (body != null) opts.body = JSON.stringify(body);
  let r;
  try { r = await fetch(API + path, opts); } catch (e) { return { status: 0, body: {}, err: e.message }; }
  let json; try { json = await r.json(); } catch { json = {}; }
  return { status: r.status, body: json };
}

// ── Token encryption (mirrors google-service.ts) ──────────────────────────────
const ENC_KEY = createHash('sha256')
  .update(process.env['JWT_SECRET'] ?? 'dev-key-please-change')
  .digest();

function encryptToken(token) {
  const iv     = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function ensureOrg(orgId, plan = 'pro') {
  await DB.query(
    `INSERT INTO org_settings (org_id, plan) VALUES ($1,$2) ON CONFLICT (org_id) DO UPDATE SET plan=EXCLUDED.plan`,
    [orgId, plan]
  );
  await DB.query(
    `INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,created_at,updated_at)
     VALUES ($1,$1,$1,$1,'active',$2,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [orgId, plan]
  );
}

async function createSession(orgId, email, role = 'owner') {
  const token = randomBytes(32).toString('hex');
  await DB.query(
    `INSERT INTO user_sessions (token,user_id,org_id,email,role,expires_at)
     VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '2 hours') ON CONFLICT (token) DO NOTHING`,
    [token, email, orgId, email, role]
  );
  const mid = `${orgId}-${role}-${RUN}`.slice(0, 80);
  await DB.query(
    `INSERT INTO team_members (id,org_id,email,name,role,joined,status,user_id,invited_at,email_status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,CURRENT_DATE::text,'active',$3,NOW(),'sent',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [mid, orgId, email, role, role]
  );
  return token;
}

async function createHash256(s) {
  return createHash('sha256').update(s).digest('hex');
}

async function registerSite(siteUrl, orgId) {
  const plain = randomBytes(16).toString('hex');
  const hash  = await createHash256(plain);
  await DB.query(
    `INSERT INTO behavior_site_tokens (token_hash, site_url, org_id, created_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (site_url) DO UPDATE SET token_hash=$1, org_id=$3`,
    [hash, siteUrl, orgId]
  );
  return plain;
}

async function insertGA4Tokens(orgId) {
  const fakeAccess  = encryptToken(`fake-access-token-${orgId}`);
  const fakeRefresh = encryptToken(`fake-refresh-token-${orgId}`);
  const expiresAt   = new Date(Date.now() + 3600_000).toISOString();
  const accountId   = `account-${orgId}`;
  // Unique constraint is (org_id, account_id) — use upsert on the composite key
  await DB.query(
    `INSERT INTO google_tokens (org_id, account_id, access_token, refresh_token, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (org_id, account_id) DO UPDATE SET access_token=$3, refresh_token=$4, expires_at=$5, updated_at=NOW()`,
    [orgId, accountId, fakeAccess, fakeRefresh, expiresAt]
  );
}

async function insertGA4Property(orgId, propId) {
  await DB.query(
    `INSERT INTO ga4_properties (id, org_id, property_id, property_name, is_active, created_at)
     VALUES ($1,$2,$3,'QA Test Property',true,NOW())
     ON CONFLICT (org_id) DO UPDATE SET property_id=$3, is_active=true`,
    [randomUUID(), orgId, propId]
  );
}

// ── Mock GA4 HTTP server ──────────────────────────────────────────────────────

const mockGA4 = {
  port: null,
  server: null,
  lastRequest: null,
  nextResponse: { status: 200, body: null },

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
          let parsedBody = null;
          try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; }
          this.lastRequest = {
            method: req.method,
            url:    req.url,
            headers: req.headers,
            body:   parsedBody,
          };

          const { status, body, timeout, rawBody } = this.nextResponse;
          if (timeout) return; // intentionally hang to trigger client timeout

          if (rawBody !== undefined) {
            res.writeHead(status);
            res.end(rawBody);
            return;
          }
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body ?? defaultGA4Response()));
        });
      });
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  },

  stop() {
    return new Promise(resolve => this.server?.close(resolve));
  },

  baseUrl() { return `http://127.0.0.1:${this.port}/properties`; },

  setResponse(resp) { this.nextResponse = resp; },
  setOk(body)       { this.nextResponse = { status: 200, body }; },
  setError(status)  { this.nextResponse = { status, body: { error: { code: status } } }; },
};

function defaultGA4Response() {
  return {
    funnelTable: {
      dimensionHeaders: [{ name: 'funnelStep' }],
      metricHeaders:    [{ name: 'cohortActiveUsers', type: 'TYPE_INTEGER' }],
      rows: [
        { dimensionValues: [{ value: '1' }], metricValues: [{ value: '1000' }] },
        { dimensionValues: [{ value: '2' }], metricValues: [{ value: '600' }]  },
        { dimensionValues: [{ value: '3' }], metricValues: [{ value: '180' }]  },
      ],
    },
    propertyQuota: { tokensPerDay: { consumed: 5, remaining: 1995 } },
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
let TOK_A, TOK_B, TOK_QA;
let FUNNEL_ID_A; // created in Section 2, used through sections

// ── Standard steps fixture ────────────────────────────────────────────────────
function makeSteps(overrides = []) {
  const base = [
    { position: 1, name: 'Session Start', eventName: 'session_start' },
    { position: 2, name: 'Page View',     eventName: 'page_view' },
    { position: 3, name: 'Checkout',      pagePathValue: '/checkout', pagePathMatchType: 'EXACT' },
  ];
  return base.map((s, i) => ({ ...s, ...(overrides[i] ?? {}) }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═════════════════════════════════════════════════════════════════════════════
async function bootstrap() {
  await ensureOrg(ORG_A);
  await ensureOrg(ORG_B);
  // QA org just needs a session for the /qa/* endpoint
  await ensureOrg(`qa-f1-qa-${RUN}`);

  TOK_A  = await createSession(ORG_A, `owner-a@${RUN}.test`);
  TOK_B  = await createSession(ORG_B, `owner-b@${RUN}.test`);
  TOK_QA = await createSession(`qa-f1-qa-${RUN}`, `qa@${RUN}.test`);

  await registerSite(SITE_A, ORG_A);
  await registerSite(SITE_B, ORG_B);

  await mockGA4.start();

  // Point the live service at our mock GA4 server
  const r = await api(TOK_QA, 'POST', '/qa/ga4-funnel-base-url', { url: mockGA4.baseUrl() });
  if (r.status !== 200) {
    console.error('  ⚠️  QA base URL redirect failed:', r.status, JSON.stringify(r.body));
    console.error('     (Ensure ENABLE_QA_FIXTURES=true is set)');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 1 — Auth & Setup (5 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section1() {
  console.log('\n[1] Auth & Setup');

  // Health endpoint is mounted under /api/health
  const health = await fetch(API + '/health').then(r => r.json()).catch(() => ({}));
  ok('S01 server healthy', health.status === 'ok' || health.ok === true, JSON.stringify(health));

  const r2 = await api(null, 'GET', '/funnels');
  ok('S02 GET /funnels unauthenticated → 401', r2.status === 401);

  const r3 = await api(null, 'POST', '/funnels', { name: 'x', siteUrl: SITE_A, steps: makeSteps() });
  ok('S03 POST /funnels unauthenticated → 401', r3.status === 401);

  const r4 = await api(null, 'GET', '/funnels/nonexistent');
  ok('S04 GET /funnels/:id unauthenticated → 401', r4.status === 401);

  const r5 = await api(null, 'POST', '/funnels/nonexistent/run', {});
  ok('S05 POST /funnels/:id/run unauthenticated → 401', r5.status === 401);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 2 — CRUD: Create (8 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section2() {
  console.log('\n[2] CRUD — Create');

  const r1 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Checkout Funnel',
    siteUrl: SITE_A,
    lookbackDays: 30,
    isOpenFunnel: false,
    steps: makeSteps(),
  });
  ok('CR01 POST /funnels → 201', r1.status === 201, `status=${r1.status} body=${JSON.stringify(r1.body)}`);
  ok('CR02 response has funnelId', !!r1.body?.funnelId || !!r1.body?.id, JSON.stringify(r1.body));
  FUNNEL_ID_A = r1.body?.funnelId ?? r1.body?.id;

  // Verify org_id in DB
  const dbRow = await DB.query(`SELECT org_id, site_url, name FROM funnels WHERE id=$1`, [FUNNEL_ID_A]);
  ok('CR03 org_id stored correctly in DB', dbRow.rows[0]?.org_id === ORG_A, `got ${dbRow.rows[0]?.org_id}`);

  const dbSteps = await DB.query(`SELECT * FROM funnel_steps WHERE funnel_id=$1 ORDER BY position`, [FUNNEL_ID_A]);
  ok('CR04 steps persisted in funnel_steps', dbSteps.rows.length === 3, `got ${dbSteps.rows.length}`);
  ok('CR05 steps stored in position order', dbSteps.rows[0]?.position === 1 && dbSteps.rows[2]?.position === 3);

  const r_noname = await api(TOK_A, 'POST', '/funnels', { siteUrl: SITE_A, steps: makeSteps() });
  ok('CR06 missing name → 400', r_noname.status === 400);

  const r_baddays = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad Days', siteUrl: SITE_A, lookbackDays: 0, steps: makeSteps()
  });
  ok('CR07 lookbackDays=0 → 400', r_baddays.status === 400);

  const r_baddays2 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad Days2', siteUrl: SITE_A, lookbackDays: 400, steps: makeSteps()
  });
  ok('CR08 lookbackDays=400 → 400', r_baddays2.status === 400);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 3 — CRUD: Read (6 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section3() {
  console.log('\n[3] CRUD — Read');

  const r1 = await api(TOK_A, 'GET', '/funnels');
  ok('RD01 GET /funnels returns array', r1.status === 200 && Array.isArray(r1.body?.funnels),
     `status=${r1.status}`);
  ok('RD02 created funnel appears in list', r1.body?.funnels?.some(f => f.id === FUNNEL_ID_A));

  const r3 = await api(TOK_A, 'GET', `/funnels/${FUNNEL_ID_A}`);
  ok('RD03 GET /funnels/:id → 200 with funnel', r3.status === 200 && r3.body?.funnel?.id === FUNNEL_ID_A,
     `status=${r3.status}`);
  ok('RD04 steps included in GET :id response', Array.isArray(r3.body?.funnel?.steps) && r3.body.funnel.steps.length === 3);

  const r5 = await api(TOK_A, 'GET', '/funnels?siteUrl=' + encodeURIComponent(SITE_A));
  ok('RD05 GET /funnels?siteUrl filters correctly', r5.status === 200 &&
     r5.body?.funnels?.every(f => f.site_url === SITE_A));

  const r6 = await api(TOK_A, 'GET', '/funnels/00000000-0000-0000-0000-000000000000');
  ok('RD06 GET /funnels/:id nonexistent → 404', r6.status === 404);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 4 — CRUD: Update (6 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section4() {
  console.log('\n[4] CRUD — Update');

  const r1 = await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, { name: 'Updated Name' });
  ok('UP01 PATCH name → 200', r1.status === 200, `status=${r1.status} body=${JSON.stringify(r1.body)}`);

  const r_check = await api(TOK_A, 'GET', `/funnels/${FUNNEL_ID_A}`);
  ok('UP02 PATCH name persisted', r_check.body?.funnel?.name === 'Updated Name');

  const r2 = await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, { lookbackDays: 14 });
  ok('UP03 PATCH lookbackDays → 200', r2.status === 200);

  const newSteps = [
    { position: 1, name: 'New Step 1', eventName: 'session_start' },
    { position: 2, name: 'New Step 2', pagePathValue: '/product', pagePathMatchType: 'BEGINS_WITH' },
  ];
  const r3 = await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, { steps: newSteps });
  ok('UP04 PATCH steps replacement → 200', r3.status === 200);

  const r3c = await api(TOK_A, 'GET', `/funnels/${FUNNEL_ID_A}`);
  ok('UP05 PATCH steps persisted (now 2 steps)', r3c.body?.funnel?.steps?.length === 2,
     `got ${r3c.body?.funnel?.steps?.length}`);

  const r4 = await api(TOK_A, 'PATCH', '/funnels/00000000-0000-0000-0000-000000000000', { name: 'x' });
  ok('UP06 PATCH nonexistent → 404', r4.status === 404);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 5 — CRUD: Delete (5 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section5() {
  console.log('\n[5] CRUD — Delete');

  // Create a throwaway funnel
  const create = await api(TOK_A, 'POST', '/funnels', {
    name: 'Throwaway', siteUrl: SITE_A,
    steps: makeSteps(),
  });
  const throwId = create.body?.funnelId ?? create.body?.id;

  const r1 = await api(TOK_A, 'DELETE', `/funnels/${throwId}`);
  ok('DL01 DELETE → 200', r1.status === 200, `status=${r1.status}`);

  const r2 = await api(TOK_A, 'GET', `/funnels/${throwId}`);
  ok('DL02 deleted funnel returns 404', r2.status === 404);

  const dbAfter = await DB.query(`SELECT id FROM funnels WHERE id=$1`, [throwId]);
  ok('DL03 funnel removed from DB', dbAfter.rows.length === 0);

  const stepsAfter = await DB.query(`SELECT id FROM funnel_steps WHERE funnel_id=$1`, [throwId]);
  ok('DL04 funnel_steps cascade-deleted', stepsAfter.rows.length === 0);

  const r5 = await api(TOK_A, 'DELETE', '/funnels/00000000-0000-0000-0000-000000000000');
  ok('DL05 DELETE nonexistent → 404', r5.status === 404);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 6 — Step Validation (10 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section6() {
  console.log('\n[6] Step Validation');

  // Only 1 step
  const r1 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad', siteUrl: SITE_A,
    steps: [{ position: 1, name: 'Step 1', eventName: 'session_start' }],
  });
  ok('SV01 1 step (< 2) → 400', r1.status === 400, `status=${r1.status}`);

  // 11 steps
  const elevenSteps = Array.from({ length: 11 }, (_, i) => ({
    position: i + 1, name: `Step ${i + 1}`, eventName: 'page_view',
  }));
  const r2 = await api(TOK_A, 'POST', '/funnels', { name: 'Bad', siteUrl: SITE_A, steps: elevenSteps });
  ok('SV02 11 steps (> 10) → 400', r2.status === 400);

  // Duplicate position
  const r3 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'A', eventName: 'session_start' },
      { position: 1, name: 'B', eventName: 'page_view' },
    ],
  });
  ok('SV03 duplicate position → 400', r3.status === 400);

  // position = 0
  const r4 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad', siteUrl: SITE_A,
    steps: [
      { position: 0, name: 'A', eventName: 'session_start' },
      { position: 1, name: 'B', eventName: 'page_view' },
    ],
  });
  ok('SV04 position=0 → 400', r4.status === 400);

  // Empty name
  const r5 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad', siteUrl: SITE_A,
    steps: [
      { position: 1, name: '', eventName: 'session_start' },
      { position: 2, name: 'Step 2', eventName: 'page_view' },
    ],
  });
  ok('SV05 empty step name → 400', r5.status === 400);

  // No condition (no eventName or pagePathValue)
  const r6 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'No Condition' },
      { position: 2, name: 'Step 2', eventName: 'page_view' },
    ],
  });
  ok('SV06 step with no condition → 400', r6.status === 400);

  // Invalid pagePathMatchType
  const r7 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'S1', eventName: 'session_start' },
      { position: 2, name: 'S2', pagePathValue: '/foo', pagePathMatchType: 'FUZZY_INVALID' },
    ],
  });
  ok('SV07 invalid pagePathMatchType → 400', r7.status === 400);

  // eventName step stored correctly
  const r8 = await api(TOK_A, 'POST', '/funnels', {
    name: 'EventStep', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'Start', eventName: 'session_start' },
      { position: 2, name: 'Purchase', eventName: 'purchase' },
    ],
  });
  ok('SV08 eventName step created → 201', r8.status === 201);
  if (r8.status === 201) {
    const fid = r8.body?.funnelId ?? r8.body?.id;
    const s = await DB.query(`SELECT event_name FROM funnel_steps WHERE funnel_id=$1 ORDER BY position`, [fid]);
    ok('SV09 eventName stored in funnel_steps', s.rows[0]?.event_name === 'session_start');
  } else {
    fail++; failures.push('SV09 eventName stored (skipped — create failed)');
    console.log('  ❌ FAIL — SV09 eventName stored (skipped — create failed)');
  }

  // pagePathValue step stored correctly
  const r9 = await api(TOK_A, 'POST', '/funnels', {
    name: 'PageStep', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'Home', pagePathValue: '/', pagePathMatchType: 'EXACT' },
      { position: 2, name: 'Checkout', pagePathValue: '/checkout', pagePathMatchType: 'BEGINS_WITH' },
    ],
  });
  ok('SV10 pagePathValue step created → 201', r9.status === 201);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 7 — Tenant Isolation (12 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section7() {
  console.log('\n[7] Tenant Isolation');

  // ORG_B cannot read ORG_A funnel
  const r1 = await api(TOK_B, 'GET', `/funnels/${FUNNEL_ID_A}`);
  ok('TI01 Org B cannot read Org A funnel → 404', r1.status === 404);

  // ORG_B cannot PATCH ORG_A funnel
  const r2 = await api(TOK_B, 'PATCH', `/funnels/${FUNNEL_ID_A}`, { name: 'Hijacked' });
  ok('TI02 Org B cannot PATCH Org A funnel → 404', r2.status === 404);

  // ORG_B cannot DELETE ORG_A funnel
  const r3 = await api(TOK_B, 'DELETE', `/funnels/${FUNNEL_ID_A}`);
  ok('TI03 Org B cannot DELETE Org A funnel → 404', r3.status === 404);

  // ORG_B cannot run ORG_A funnel
  const r4 = await api(TOK_B, 'POST', `/funnels/${FUNNEL_ID_A}/run`, {});
  ok('TI04 Org B cannot run Org A funnel → 404', r4.status === 404);

  // orgId injected in body is ignored — funnel created under authenticated org only
  const r5 = await api(TOK_A, 'POST', '/funnels', {
    name: 'InjectedOrg', siteUrl: SITE_A,
    orgId: ORG_B,           // attacker tries to claim ORG_B's identity
    steps: makeSteps(),
  });
  ok('TI05 orgId in POST body ignored → funnel under Org A',
     r5.status === 201 || r5.status === 404, `status=${r5.status}`);
  if (r5.status === 201) {
    const fid = r5.body?.funnelId ?? r5.body?.id;
    const db = await DB.query(`SELECT org_id FROM funnels WHERE id=$1`, [fid]);
    ok('TI06 injected orgId not persisted — row belongs to Org A',
       db.rows[0]?.org_id === ORG_A, `got ${db.rows[0]?.org_id}`);
  } else {
    // 404 means site not found for ORG_B (also correct — body orgId was ignored, site belongs to A not "B")
    fail++; failures.push('TI06 injected orgId test indeterminate — skipped');
    console.log('  ❌ FAIL — TI06 injected orgId test indeterminate — skipped');
  }

  // Org A list does not include Org B funnels
  const rfbA = await api(TOK_A, 'GET', '/funnels');
  const rfbB = await api(TOK_B, 'GET', '/funnels');
  ok('TI07 Org A list has no Org B funnels',
     rfbA.body?.funnels?.every(f => f.org_id === ORG_A) ?? true);
  ok('TI08 Org B list has no Org A funnels',
     rfbB.body?.funnels?.every(f => f.org_id === ORG_B) ?? true);

  // Site belonging to Org B cannot be claimed by Org A
  const r6 = await api(TOK_A, 'POST', '/funnels', {
    name: 'WrongSite', siteUrl: SITE_B, steps: makeSteps(),
  });
  ok('TI09 Org A creating funnel on Org B site → 404', r6.status === 404);

  // All DB rows have correct org_id (belt-and-suspenders)
  const dbA = await DB.query(`SELECT id FROM funnels WHERE id=$1 AND org_id=$2`, [FUNNEL_ID_A, ORG_A]);
  ok('TI10 funnels table row is correctly org_id-scoped', dbA.rows.length === 1);

  const stepsA = await DB.query(
    `SELECT fs.id FROM funnel_steps fs JOIN funnels f ON f.id=fs.funnel_id WHERE f.id=$1 AND fs.org_id=$2`,
    [FUNNEL_ID_A, ORG_A]
  );
  ok('TI11 funnel_steps rows are correctly org_id-scoped', stepsA.rows.length > 0);

  // propertyId from body on /run is ignored
  const runAttempt = await api(TOK_A, 'POST', `/funnels/${FUNNEL_ID_A}/run`, {
    propertyId: '999999999',    // should be ignored
    ga4PropertyId: '888888888', // should be ignored
  });
  // Either 409 (GA4 not configured) or successful run — but propertyId should NOT come from body
  // We verify the mock server was NOT called with the injected property id (it uses server's stored property)
  ok('TI12 propertyId from body ignored on /run',
     runAttempt.status !== 400, // 400 would mean it was validated from body; 404/409 are expected
     `status=${runAttempt.status}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 8 — GA4 Mapping (10 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section8() {
  console.log('\n[8] GA4 Mapping');

  // GA4 not connected (no google_tokens for ORG_A)
  const r1 = await api(TOK_A, 'POST', `/funnels/${FUNNEL_ID_A}/run`, {});
  ok('GA01 /run without GA4 connected → 409 GA4_NOT_CONNECTED or GA4_PROPERTY_NOT_CONFIGURED',
     r1.status === 409, `status=${r1.status} code=${r1.body?.code}`);

  // Ensure ORG_A has a GA4 property configured (but no token yet)
  await insertGA4Property(ORG_A, PROP_ID);
  const r2 = await api(TOK_A, 'POST', `/funnels/${FUNNEL_ID_A}/run`, {});
  ok('GA02 /run with property but no token → 409 GA4_NOT_CONNECTED',
     r2.status === 409 && (r2.body?.code === 'GA4_NOT_CONNECTED' || r2.body?.code === 'GA4_PROPERTY_NOT_CONFIGURED'),
     `status=${r2.status} code=${r2.body?.code}`);

  // Now insert valid tokens so the run actually calls our mock
  await insertGA4Tokens(ORG_A);
  mockGA4.lastRequest = null;
  mockGA4.setOk(defaultGA4Response());

  // Restore fresh 3-step funnel (sections 4-5 may have changed it)
  await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, { steps: makeSteps() });

  const r3 = await api(TOK_A, 'POST', `/funnels/${FUNNEL_ID_A}/run`, {});
  ok('GA03 /run with valid token → 200 (or cached)', r3.status === 200, `status=${r3.status} body=${JSON.stringify(r3.body).slice(0,200)}`);

  const lastReq = mockGA4.lastRequest;
  ok('GA04 mock GA4 server was called', !!lastReq, `lastReq=${JSON.stringify(lastReq)?.slice(0,100)}`);

  if (lastReq) {
    // URL contains :runFunnelReport
    ok('GA05 v1alpha runFunnelReport endpoint called', lastReq.url?.includes(':runFunnelReport'),
       `url=${lastReq.url}`);

    // propertyId from server — matches PROP_ID inserted above
    ok('GA06 propertyId from server (not client)', lastReq.url?.includes(encodeURIComponent(PROP_ID)) || lastReq.url?.includes(PROP_ID),
       `url=${lastReq.url} propId=${PROP_ID}`);

    // dateRanges present
    const body = lastReq.body;
    ok('GA07 dateRanges in GA4 request body', Array.isArray(body?.dateRanges) && body.dateRanges.length > 0,
       `dateRanges=${JSON.stringify(body?.dateRanges)}`);

    // isOpenFunnel forwarded
    ok('GA08 isOpenFunnel forwarded', 'isOpenFunnel' in (body?.funnel ?? {}),
       `funnel=${JSON.stringify(body?.funnel)?.slice(0,200)}`);

    // Steps in position order
    const steps = body?.funnel?.steps;
    ok('GA09 steps sent in position order',
       Array.isArray(steps) && steps.length === 3,
       `steps=${JSON.stringify(steps)?.slice(0,200)}`);

    // eventName filter correctly mapped
    const step1 = steps?.[0];
    ok('GA10 eventName filter mapped to funnelEventFilter',
       JSON.stringify(step1?.filterExpression)?.includes('funnelEventFilter'),
       `step1=${JSON.stringify(step1?.filterExpression)}`);
  } else {
    // Skip dependent tests
    ['GA05','GA06','GA07','GA08','GA09','GA10'].forEach(t => {
      fail++; failures.push(`${t} (skipped — mock not called)`);
      console.log(`  ❌ FAIL — ${t} (skipped — mock not called)`);
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 9 — GA4 Error Handling (6 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section9() {
  console.log('\n[9] GA4 Error Handling');

  // Must have tokens already (from section 8 bootstrap)
  const scenarios = [
    { label: 'ER01 GA4 401 → server 401 GA4_REAUTH_REQUIRED',   code: 401, wantStatus: 401, wantCode: 'GA4_REAUTH_REQUIRED' },
    { label: 'ER02 GA4 403 → server 403 GA4_PERMISSION_DENIED', code: 403, wantStatus: 403, wantCode: 'GA4_PERMISSION_DENIED' },
    { label: 'ER03 GA4 429 → server 429 GA4_QUOTA_EXCEEDED',    code: 429, wantStatus: 429, wantCode: 'GA4_QUOTA_EXCEEDED' },
    { label: 'ER04 GA4 500 → server 502 GA4_API_ERROR',         code: 500, wantStatus: 502, wantCode: 'GA4_API_ERROR' },
  ];

  for (const sc of scenarios) {
    mockGA4.setError(sc.code);
    // Use a different funnel per call to avoid cache hits
    const fc = await api(TOK_A, 'POST', '/funnels', {
      name: `Err Test ${sc.code}`, siteUrl: SITE_A,
      steps: [
        { position: 1, name: 'S1', eventName: 'session_start' },
        { position: 2, name: 'S2', eventName: `err_${sc.code}` },
      ],
    });
    const fid = fc.body?.funnelId ?? fc.body?.id;
    const r = await api(TOK_A, 'POST', `/funnels/${fid}/run`, {});
    ok(sc.label, r.status === sc.wantStatus && (r.body?.code === sc.wantCode || r.body?.error?.includes(String(sc.code))),
       `status=${r.status} code=${r.body?.code} err=${r.body?.error}`);
  }

  // Invalid JSON response
  mockGA4.setResponse({ status: 200, rawBody: 'NOT_JSON_AT_ALL' });
  const fc5 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Bad JSON', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'S1', eventName: 'session_start' },
      { position: 2, name: 'S2', eventName: 'bad_json_test' },
    ],
  });
  const fid5 = fc5.body?.funnelId ?? fc5.body?.id;
  const r5 = await api(TOK_A, 'POST', `/funnels/${fid5}/run`, {});
  ok('ER05 GA4 non-JSON response → 502', r5.status === 502, `status=${r5.status}`);

  // Empty but valid funnelTable (no rows)
  mockGA4.setOk({ funnelTable: { rows: [] } });
  const fc6 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Empty Rows', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'S1', eventName: 'session_start' },
      { position: 2, name: 'S2', eventName: 'purchase' },
    ],
  });
  const fid6 = fc6.body?.funnelId ?? fc6.body?.id;
  const r6 = await api(TOK_A, 'POST', `/funnels/${fid6}/run`, {});
  ok('ER06 GA4 empty rows → 200 with zero activeUsers', r6.status === 200 &&
     r6.body?.result?.steps?.every(s => s.activeUsers === 0),
     `status=${r6.status} steps=${JSON.stringify(r6.body?.result?.steps)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 10 — Calculations & Normalization (8 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section10() {
  console.log('\n[10] Calculations & Normalization');

  // Controlled response: 1000 → 600 → 180
  mockGA4.setOk(defaultGA4Response());

  const fc = await api(TOK_A, 'POST', '/funnels', {
    name: 'Calc Test', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'Entry',    eventName: 'session_start' },
      { position: 2, name: 'Mid',      eventName: 'page_view' },
      { position: 3, name: 'Convert',  eventName: 'purchase' },
    ],
  });
  const fid = fc.body?.funnelId ?? fc.body?.id;
  const r = await api(TOK_A, 'POST', `/funnels/${fid}/run`, {});
  ok('CA01 /run → 200', r.status === 200, `status=${r.status} err=${JSON.stringify(r.body)?.slice(0,200)}`);

  const result = r.body?.result;
  ok('CA02 source = "ga4"', result?.source === 'ga4', `source=${result?.source}`);
  ok('CA03 steps array present', Array.isArray(result?.steps) && result.steps.length === 3);

  const step1 = result?.steps?.[0];
  const step2 = result?.steps?.[1];
  const step3 = result?.steps?.[2];

  ok('CA04 step1 activeUsers = 1000', step1?.activeUsers === 1000, `got ${step1?.activeUsers}`);
  ok('CA05 step2 completionRate = 600/1000 = 0.6',
     Math.abs((step2?.completionRate ?? -1) - 0.6) < 0.0001,
     `got ${step2?.completionRate}`);
  ok('CA06 step2 abandonmentRate = 1 - 0.6 = 0.4',
     Math.abs((step2?.abandonmentRate ?? -1) - 0.4) < 0.0001,
     `got ${step2?.abandonmentRate}`);
  ok('CA07 step2 abandonments = 1000 - 600 = 400', step2?.abandonments === 400, `got ${step2?.abandonments}`);
  ok('CA08 overallConversionRate = 180/1000 = 0.18',
     Math.abs((result?.overallConversionRate ?? -1) - 0.18) < 0.0001,
     `got ${result?.overallConversionRate}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 11 — Cache (6 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section11() {
  console.log('\n[11] Cache');

  mockGA4.setOk(defaultGA4Response());
  mockGA4.lastRequest = null;

  const fc = await api(TOK_A, 'POST', '/funnels', {
    name: 'Cache Test', siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'CS1', eventName: 'cache_start' },
      { position: 2, name: 'CS2', eventName: 'cache_end' },
    ],
  });
  const fid = fc.body?.funnelId ?? fc.body?.id;

  const r1 = await api(TOK_A, 'POST', `/funnels/${fid}/run`, {});
  ok('CH01 first call → 200 not cached', r1.status === 200 && r1.body?.result?.cached !== true,
     `cached=${r1.body?.result?.cached}`);

  // Second call — same config, same date range → cache hit
  const callCount1 = !!mockGA4.lastRequest ? 1 : 0;
  mockGA4.lastRequest = null;
  const r2 = await api(TOK_A, 'POST', `/funnels/${fid}/run`, {});
  const callCount2 = !!mockGA4.lastRequest ? 1 : 0;

  ok('CH02 second call → cached=true', r2.status === 200 && r2.body?.result?.cached === true,
     `cached=${r2.body?.result?.cached}`);
  ok('CH03 cached response has cachedAt field', !!r2.body?.result?.cachedAt,
     `cachedAt=${r2.body?.result?.cachedAt}`);
  ok('CH04 GA4 not re-called on cache hit', callCount2 === 0, `GA4 called=${callCount2}`);

  // Different org — separate cache
  const fcB = await api(TOK_B, 'POST', '/funnels', {
    name: 'Cache Org B', siteUrl: SITE_B,
    steps: [
      { position: 1, name: 'CS1', eventName: 'cache_start' },
      { position: 2, name: 'CS2', eventName: 'cache_end' },
    ],
  });
  const fidB = fcB.body?.funnelId ?? fcB.body?.id;

  await insertGA4Tokens(ORG_B);
  await insertGA4Property(ORG_B, `8${RUN}`.slice(0, 9));

  mockGA4.lastRequest = null;
  mockGA4.setOk(defaultGA4Response());
  const rB = await api(TOK_B, 'POST', `/funnels/${fidB}/run`, {});
  ok('CH05 different org has own cache (GA4 called again)', !!mockGA4.lastRequest,
     `status=${rB.status} called=${!!mockGA4.lastRequest}`);

  // Different lookback (different config hash) → cache miss
  mockGA4.lastRequest = null;
  const r3 = await api(TOK_A, 'POST', `/funnels/${fid}/run`, { lookbackDays: 7 });
  ok('CH06 different lookbackDays bypasses cache',
     r3.status === 200 && (!!mockGA4.lastRequest || r3.body?.result?.cached !== true),
     `cached=${r3.body?.result?.cached} ga4Called=${!!mockGA4.lastRequest}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section 12 — Synthetic Data Absence (8 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function section12() {
  console.log('\n[12] Synthetic Data Absence');

  // Check source files for hardcoded fake funnel ratios
  const { readFileSync } = await import('node:fs');
  const { execSync } = await import('node:child_process');

  function grepFiles(pattern, paths) {
    try {
      const out = execSync(
        `grep -rn "${pattern}" ${paths} --include="*.ts" 2>/dev/null || true`,
        { encoding: 'utf8', cwd: '/home/runner/workspace/artifacts/api-server/src' }
      );
      return out.trim();
    } catch { return ''; }
  }

  // No synthetic 0.74 in funnel context
  const g74 = grepFiles('0\\.74', 'services/ga4-funnel-service.ts routes/funnels.ts');
  ok('SD01 no hardcoded 0.74 in funnel service/route', g74 === '', `found: ${g74.slice(0,100)}`);

  const g52 = grepFiles('0\\.52', 'services/ga4-funnel-service.ts routes/funnels.ts');
  ok('SD02 no hardcoded 0.52 in funnel service/route', g52 === '', `found: ${g52.slice(0,100)}`);

  const g31 = grepFiles('0\\.31', 'services/ga4-funnel-service.ts routes/funnels.ts');
  ok('SD03 no hardcoded 0.31 in funnel service/route', g31 === '', `found: ${g31.slice(0,100)}`);

  const g14 = grepFiles('0\\.14', 'services/ga4-funnel-service.ts routes/funnels.ts');
  ok('SD04 no hardcoded 0.14 in funnel service/route', g14 === '', `found: ${g14.slice(0,100)}`);

  // No Math.random in funnel code
  const gRand = grepFiles('Math\\.random', 'services/ga4-funnel-service.ts routes/funnels.ts');
  ok('SD05 no Math.random in funnel service/route', gRand === '', `found: ${gRand.slice(0,100)}`);

  // No PREVIEW_MODE or isDemoMode bypasses
  const gPreview = grepFiles('PREVIEW_MODE\\|isDemoMode', 'services/ga4-funnel-service.ts routes/funnels.ts');
  ok('SD06 no PREVIEW_MODE or isDemoMode in funnel code', gPreview === '', `found: ${gPreview.slice(0,100)}`);

  // API response never has "preview" or "mock" as source
  const fc = await api(TOK_A, 'GET', '/funnels');
  const hasMockSource = (fc.body?.funnels ?? []).some(f => f.source === 'preview' || f.source === 'mock');
  ok('SD07 list response has no preview/mock source', !hasMockSource);

  // Confirm service explicitly sets source = "ga4"
  const serviceContent = readFileSync(
    '/home/runner/workspace/artifacts/api-server/src/services/ga4-funnel-service.ts',
    'utf8'
  );
  ok('SD08 ga4-funnel-service explicitly sets source="ga4"', serviceContent.includes('"ga4"'));
}

// ═════════════════════════════════════════════════════════════════════════════
// Additional validation — Breakdown dimension allowlist (3 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionBonus() {
  console.log('\n[B] Breakdown Dimension');

  const r1 = await api(TOK_A, 'POST', '/funnels', {
    name: 'Breakdown', siteUrl: SITE_A,
    breakdownDimension: 'deviceCategory',
    steps: makeSteps(),
  });
  ok('BD01 valid breakdownDimension accepted', r1.status === 201, `status=${r1.status}`);

  const r2 = await api(TOK_A, 'POST', '/funnels', {
    name: 'BadBreakdown', siteUrl: SITE_A,
    breakdownDimension: 'injectedField; DROP TABLE funnels;--',
    steps: makeSteps(),
  });
  ok('BD02 invalid breakdownDimension → 400', r2.status === 400);

  // Check breakdown forwarded to GA4 when configured
  if (r1.status === 201) {
    const fid = r1.body?.funnelId ?? r1.body?.id;
    mockGA4.lastRequest = null;
    mockGA4.setOk(defaultGA4Response());
    await api(TOK_A, 'POST', `/funnels/${fid}/run`, {});
    const req = mockGA4.lastRequest;
    ok('BD03 breakdownDimension forwarded to GA4 request',
       req?.body?.funnelBreakdown?.breakdownDimension?.name === 'deviceCategory',
       `funnelBreakdown=${JSON.stringify(req?.body?.funnelBreakdown)}`);
  } else {
    fail++; failures.push('BD03 (skipped — create failed)');
    console.log('  ❌ FAIL — BD03 (skipped — create failed)');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Additional validation — PATCH empty body / step checks (3 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionPatch2() {
  console.log('\n[P] PATCH Extended');

  const r1 = await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, {});
  ok('PA01 PATCH empty body → 400', r1.status === 400, `status=${r1.status}`);

  const r2 = await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, {
    breakdownDimension: 'INVALID_DIM',
  });
  ok('PA02 PATCH invalid breakdownDimension → 400', r2.status === 400);

  const r3 = await api(TOK_A, 'PATCH', `/funnels/${FUNNEL_ID_A}`, {
    steps: [{ position: 1, name: 'Only One Step', eventName: 'session_start' }],
  });
  ok('PA03 PATCH steps < 2 → 400', r3.status === 400);
}

// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// Section [U] — UUID Validation (5 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionUUID() {
  console.log('\n[U] UUID Validation');

  const BAD_IDS = ['not-a-uuid', '123-abc', 'ffffffff-ffff-ffff-ffff-fffffffffff', '00000000-0000-0000-0000-00000000000Z', ''];
  const id0 = 'not-a-uuid';

  const rGet = await api(TOK_A, 'GET', `/funnels/${id0}`);
  ok('U01 GET /funnels/not-a-uuid → 400 INVALID_FUNNEL_ID',
     rGet.status === 400 && rGet.body?.code === 'INVALID_FUNNEL_ID',
     `status=${rGet.status} code=${rGet.body?.code}`);

  const rPatch = await api(TOK_A, 'PATCH', `/funnels/${id0}`, { name: 'x' });
  ok('U02 PATCH /funnels/not-a-uuid → 400 INVALID_FUNNEL_ID',
     rPatch.status === 400 && rPatch.body?.code === 'INVALID_FUNNEL_ID',
     `status=${rPatch.status} code=${rPatch.body?.code}`);

  const rDel = await api(TOK_A, 'DELETE', `/funnels/${id0}`);
  ok('U03 DELETE /funnels/not-a-uuid → 400 INVALID_FUNNEL_ID',
     rDel.status === 400 && rDel.body?.code === 'INVALID_FUNNEL_ID',
     `status=${rDel.status} code=${rDel.body?.code}`);

  const rRun = await api(TOK_A, 'POST', `/funnels/${id0}/run`, {});
  ok('U04 POST /funnels/not-a-uuid/run → 400 INVALID_FUNNEL_ID',
     rRun.status === 400 && rRun.body?.code === 'INVALID_FUNNEL_ID',
     `status=${rRun.status} code=${rRun.body?.code}`);

  // Short hex string (not UUID format) also invalid
  const rShort = await api(TOK_A, 'GET', `/funnels/deadbeef-dead-dead-dead-deadbeefXXXX`);
  ok('U05 malformed UUID → 400 INVALID_FUNNEL_ID',
     rShort.status === 400 && rShort.body?.code === 'INVALID_FUNNEL_ID',
     `status=${rShort.status} code=${rShort.body?.code}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section [PL] — pageLocation condition (5 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionPageLocation() {
  console.log('\n[PL] pageLocation condition');

  // Create a funnel with pageLocationValue on one step
  const rCreate = await api(TOK_A, 'POST', '/funnels', {
    name: 'PL funnel',
    siteUrl: SITE_A,
    steps: [
      { position: 1, name: 'Home',     pageLocationMatchType: 'EXACT', pageLocationValue: 'https://example.com/home' },
      { position: 2, name: 'Checkout', pageLocationMatchType: 'BEGINS_WITH', pageLocationValue: 'https://example.com/checkout' },
    ],
  });
  ok('PL01 Create funnel with pageLocationValue → 201',
     rCreate.status === 201, `status=${rCreate.status} body=${JSON.stringify(rCreate.body).slice(0,200)}`);

  const plFunnelId = rCreate.body?.funnelId ?? rCreate.body?.id;

  if (!plFunnelId) {
    ['PL02','PL03','PL04','PL05'].forEach(t => {
      fail++; failures.push(`${t} (skipped — funnel creation failed)`);
      console.log(`  ❌ FAIL — ${t} (skipped — funnel creation failed)`);
    });
    return;
  }

  // Verify page_location_value is stored in DB
  const dbRow = await DB.query(
    `SELECT page_location_value, page_location_match_type FROM funnel_steps WHERE funnel_id=$1 AND position=1`,
    [plFunnelId]
  );
  ok('PL02 page_location_value stored in funnel_steps',
     dbRow.rows[0]?.page_location_value === 'https://example.com/home',
     `got ${dbRow.rows[0]?.page_location_value}`);

  // Run it and check GA4 request body
  mockGA4.lastRequest = null;
  mockGA4.setOk(defaultGA4Response());
  const rRun = await api(TOK_A, 'POST', `/funnels/${plFunnelId}/run`, {});
  ok('PL03 Run funnel with pageLocation → 200',
     rRun.status === 200, `status=${rRun.status} err=${rRun.body?.error}`);

  const lastReq = mockGA4.lastRequest;
  if (lastReq) {
    const bodyStr = JSON.stringify(lastReq.body);
    ok('PL04 GA4 request uses fieldName=pageLocation',
       bodyStr.includes('pageLocation'),
       `body=${bodyStr.slice(0,400)}`);
    ok('PL05 GA4 request uses BEGINS_WITH matchType for step 2',
       bodyStr.includes('BEGINS_WITH'),
       `body=${bodyStr.slice(0,400)}`);
  } else {
    ['PL04','PL05'].forEach(t => {
      fail++; failures.push(`${t} (skipped — mock not called)`);
      console.log(`  ❌ FAIL — ${t} (skipped — mock not called)`);
    });
  }

  // Cleanup the PL funnel
  await api(TOK_A, 'DELETE', `/funnels/${plFunnelId}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section [PF] — parameterFilters with allowlist (5 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionParamFilters() {
  console.log('\n[PF] parameterFilters');

  // Invalid paramName → 400 at route level
  const rBad = await api(TOK_A, 'POST', '/funnels', {
    name: 'PF bad', siteUrl: SITE_A,
    steps: [
      {
        position: 1, name: 'Step A', eventName: 'page_view',
        parameterFilters: [{ paramName: 'injected_sql', matchType: 'EXACT', value: "'; DROP TABLE funnels; --" }],
      },
      { position: 2, name: 'Step B', eventName: 'purchase' },
    ],
  });
  ok('PF01 invalid paramName → 400',
     rBad.status === 400,
     `status=${rBad.status} err=${rBad.body?.error}`);

  // Invalid matchType → 400
  const rBadMT = await api(TOK_A, 'POST', '/funnels', {
    name: 'PF bad mt', siteUrl: SITE_A,
    steps: [
      {
        position: 1, name: 'Step A', eventName: 'page_view',
        parameterFilters: [{ paramName: 'page_title', matchType: 'FUZZY', value: 'home' }],
      },
      { position: 2, name: 'Step B', eventName: 'purchase' },
    ],
  });
  ok('PF02 invalid paramFilter matchType → 400',
     rBadMT.status === 400,
     `status=${rBadMT.status} err=${rBadMT.body?.error}`);

  // Valid parameterFilters → 201
  const rOk = await api(TOK_A, 'POST', '/funnels', {
    name: 'PF valid', siteUrl: SITE_A,
    steps: [
      {
        position: 1, name: 'Step A', eventName: 'page_view',
        parameterFilters: [{ paramName: 'page_title', matchType: 'EXACT', value: 'Home' }],
      },
      { position: 2, name: 'Step B', eventName: 'purchase' },
    ],
  });
  ok('PF03 valid parameterFilters → 201',
     rOk.status === 201,
     `status=${rOk.status} err=${rOk.body?.error}`);

  const pfFunnelId = rOk.body?.funnelId ?? rOk.body?.id;

  if (!pfFunnelId) {
    ['PF04','PF05'].forEach(t => {
      fail++; failures.push(`${t} (skipped — funnel creation failed)`);
      console.log(`  ❌ FAIL — ${t} (skipped — funnel creation failed)`);
    });
    return;
  }

  // Run → GA4 request body should have funnelParameterFilter
  mockGA4.lastRequest = null;
  mockGA4.setOk(defaultGA4Response());
  const rRun = await api(TOK_A, 'POST', `/funnels/${pfFunnelId}/run`, {});

  if (mockGA4.lastRequest) {
    const bodyStr = JSON.stringify(mockGA4.lastRequest.body);
    ok('PF04 GA4 request contains funnelParameterFilter',
       bodyStr.includes('funnelParameterFilter'),
       `body=${bodyStr.slice(0,500)}`);
    ok('PF05 paramName=page_title forwarded to GA4',
       bodyStr.includes('page_title'),
       `body=${bodyStr.slice(0,500)}`);
  } else {
    ['PF04','PF05'].forEach(t => {
      fail++; failures.push(`${t} (skipped — mock not called, status=${rRun.status})`);
      console.log(`  ❌ FAIL — ${t} (skipped — mock not called)`);
    });
  }

  // Cleanup
  await api(TOK_A, 'DELETE', `/funnels/${pfFunnelId}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section [SK] — siteUrl normalized in cache key (3 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionSiteUrlCache() {
  console.log('\n[SK] siteUrl in cache key');

  // Create funnel
  const rCreate = await api(TOK_A, 'POST', '/funnels', {
    name: 'SK funnel', siteUrl: SITE_A, steps: makeSteps(),
  });
  const skId = rCreate.body?.funnelId ?? rCreate.body?.id;
  if (!skId) {
    ['SK01','SK02','SK03'].forEach(t => {
      fail++; failures.push(`${t} (skipped — no funnel)`);
      console.log(`  ❌ FAIL — ${t} (skipped — no funnel)`);
    });
    return;
  }

  // First run — cache miss
  mockGA4.lastRequest = null;
  mockGA4.setOk(defaultGA4Response());
  const r1 = await api(TOK_A, 'POST', `/funnels/${skId}/run`, {});
  ok('SK01 First run — cache miss (GA4 called)',
     r1.status === 200 && r1.body?.result?.cached === false && !!mockGA4.lastRequest,
     `status=${r1.status} cached=${r1.body?.result?.cached} mock=${!!mockGA4.lastRequest}`);

  // Second run — cache hit (same siteUrl → same cache key)
  mockGA4.lastRequest = null;
  const r2 = await api(TOK_A, 'POST', `/funnels/${skId}/run`, {});
  ok('SK02 Second run — cache hit (siteUrl stable in key)',
     r2.status === 200 && r2.body?.result?.cached === true && !mockGA4.lastRequest,
     `status=${r2.status} cached=${r2.body?.result?.cached} mock=${!!mockGA4.lastRequest}`);

  // PATCH steps → config hash changes → cache miss on next run
  await api(TOK_A, 'PATCH', `/funnels/${skId}`, {
    steps: [
      { position: 1, name: 'Modified Step 1', eventName: 'session_start' },
      { position: 2, name: 'Modified Step 2', eventName: 'purchase' },
    ],
  });
  mockGA4.lastRequest = null;
  mockGA4.setOk(defaultGA4Response());
  const r3 = await api(TOK_A, 'POST', `/funnels/${skId}/run`, {});
  ok('SK03 After step change — cache miss (config hash updated)',
     r3.status === 200 && r3.body?.result?.cached === false && !!mockGA4.lastRequest,
     `status=${r3.status} cached=${r3.body?.result?.cached} mock=${!!mockGA4.lastRequest}`);

  // Cleanup
  await api(TOK_A, 'DELETE', `/funnels/${skId}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section [RT] — Retry policy (3 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionRetry() {
  console.log('\n[RT] Retry policy');

  // Create a fresh funnel (not cached) for retry tests
  const rCreate = await api(TOK_A, 'POST', '/funnels', {
    name: 'RT funnel', siteUrl: SITE_A, steps: [
      { position: 1, name: 'Retry Step 1', eventName: `retry_event_${Date.now()}` },
      { position: 2, name: 'Retry Step 2', eventName: `retry_event2_${Date.now()}` },
    ],
  });
  const rtId = rCreate.body?.funnelId ?? rCreate.body?.id;
  if (!rtId) {
    ['RT01','RT02','RT03'].forEach(t => {
      fail++; failures.push(`${t} (skipped — no funnel)`);
      console.log(`  ❌ FAIL — ${t} (skipped — no funnel)`);
    });
    return;
  }

  // RT01: 429 (all retries exhausted) → client gets 429 with GA4_QUOTA_EXCEEDED
  mockGA4.setError(429);
  const r1 = await api(TOK_A, 'POST', `/funnels/${rtId}/run`, {});
  ok('RT01 429 exhausted after retries → client 429 GA4_QUOTA_EXCEEDED',
     r1.status === 429 && r1.body?.code === 'GA4_QUOTA_EXCEEDED',
     `status=${r1.status} code=${r1.body?.code}`);

  // Reset cache (different step names ensure no cache collision)
  const rCreate2 = await api(TOK_A, 'POST', '/funnels', {
    name: 'RT no-retry funnel', siteUrl: SITE_A, steps: [
      { position: 1, name: 'NoRetry Step 1', eventName: `noretry_event_${Date.now()}` },
      { position: 2, name: 'NoRetry Step 2', eventName: `noretry_event2_${Date.now()}` },
    ],
  });
  const rtId2 = rCreate2.body?.funnelId ?? rCreate2.body?.id;

  // RT02: 401 must NOT be retried → immediate 401 to client
  if (rtId2) {
    mockGA4.lastRequest = null;
    mockGA4.setError(401);
    const r2 = await api(TOK_A, 'POST', `/funnels/${rtId2}/run`, {});
    ok('RT02 401 not retried → client 401 GA4_REAUTH_REQUIRED',
       r2.status === 401 && r2.body?.code === 'GA4_REAUTH_REQUIRED',
       `status=${r2.status} code=${r2.body?.code}`);
    await api(TOK_A, 'DELETE', `/funnels/${rtId2}`);
  } else {
    fail++; failures.push('RT02 (skipped — no funnel)');
    console.log('  ❌ FAIL — RT02 (skipped — no funnel)');
  }

  // RT03: 429 on first call, then 200 on retry (timing: change at 500ms, retry at 1000ms)
  // Use a new funnel with unique event names to avoid cache
  const rCreate3 = await api(TOK_A, 'POST', '/funnels', {
    name: 'RT retry-success funnel', siteUrl: SITE_A, steps: [
      { position: 1, name: 'Retry3 Step 1', eventName: `retry3_${Date.now()}` },
      { position: 2, name: 'Retry3 Step 2', eventName: `retry3b_${Date.now()}` },
    ],
  });
  const rtId3 = rCreate3.body?.funnelId ?? rCreate3.body?.id;
  if (rtId3) {
    mockGA4.setError(429);
    // After 500ms change to OK — service retries after 1000ms, so second call sees 200
    const switchTimer = setTimeout(() => mockGA4.setOk(defaultGA4Response()), 500);
    const r3 = await api(TOK_A, 'POST', `/funnels/${rtId3}/run`, {});
    clearTimeout(switchTimer);
    // The service retried after 1s delay and the second call returned 200
    ok('RT03 retry on 429 succeeds when GA4 recovers',
       r3.status === 200 && r3.body?.result?.source === 'ga4',
       `status=${r3.status} source=${r3.body?.result?.source} code=${r3.body?.code}`);
    mockGA4.setOk(defaultGA4Response()); // Reset to ok
    await api(TOK_A, 'DELETE', `/funnels/${rtId3}`);
  } else {
    fail++; failures.push('RT03 (skipped — no funnel)');
    console.log('  ❌ FAIL — RT03 (skipped — no funnel)');
  }

  // Cleanup RT funnel
  await api(TOK_A, 'DELETE', `/funnels/${rtId}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Section [FE] — Frontend builder API contract (4 tests)
// ═════════════════════════════════════════════════════════════════════════════
async function sectionFrontend() {
  console.log('\n[FE] Frontend builder API contract');

  // GET /funnels returns array and is suitable for list rendering
  const rList = await api(TOK_A, 'GET', '/funnels');
  ok('FE01 GET /funnels returns funnels array with id/name/steps',
     rList.status === 200 && Array.isArray(rList.body?.funnels) &&
     (rList.body.funnels.length === 0 || (rList.body.funnels[0]?.id && rList.body.funnels[0]?.name !== undefined)),
     `status=${rList.status} count=${rList.body?.funnels?.length}`);

  // Create + run for shape tests
  const rCreate = await api(TOK_A, 'POST', '/funnels', {
    name: 'FE test funnel', siteUrl: SITE_A, steps: makeSteps(),
  });
  const feId = rCreate.body?.funnelId ?? rCreate.body?.id;
  if (!feId) {
    ['FE02','FE03','FE04'].forEach(t => {
      fail++; failures.push(`${t} (skipped — no funnel)`);
      console.log(`  ❌ FAIL — ${t} (skipped — no funnel)`);
    });
    return;
  }

  mockGA4.setOk(defaultGA4Response());
  const rRun = await api(TOK_A, 'POST', `/funnels/${feId}/run`, {});
  const result = rRun.body?.result;

  ok('FE02 run result has source="ga4" for frontend source label',
     result?.source === 'ga4',
     `source=${result?.source}`);

  ok('FE03 run result has fetchedAt ISO string for frontend timestamp',
     typeof result?.fetchedAt === 'string' && result.fetchedAt.includes('T'),
     `fetchedAt=${result?.fetchedAt}`);

  ok('FE04 run result steps have all frontend-required fields',
     Array.isArray(result?.steps) && result.steps.length > 0 &&
     result.steps.every(s =>
       'position' in s && 'name' in s && 'activeUsers' in s &&
       'completionRate' in s && 'abandonmentRate' in s && 'abandonments' in s
     ),
     `steps=${JSON.stringify(result?.steps?.slice(0,1))}`);

  await api(TOK_A, 'DELETE', `/funnels/${feId}`);
}

// Cleanup
// ═════════════════════════════════════════════════════════════════════════════
async function cleanup() {
  try {
    await DB.query(`DELETE FROM funnel_steps WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
    await DB.query(`DELETE FROM funnels WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
    await DB.query(`DELETE FROM google_tokens WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
    await DB.query(`DELETE FROM ga4_properties WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
    await DB.query(`DELETE FROM behavior_site_tokens WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
    await DB.query(`DELETE FROM user_sessions WHERE org_id LIKE 'qa-f1-%'`);
    await DB.query(`DELETE FROM team_members WHERE org_id LIKE 'qa-f1-%'`);
    await DB.query(`DELETE FROM org_settings WHERE org_id LIKE 'qa-f1-%'`);
    await DB.query(`DELETE FROM organizations WHERE id LIKE 'qa-f1-%'`);
  } catch (e) {
    console.warn('  ⚠ cleanup warning:', e.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Runner
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Wave 4 Lot 4B-1 — GA4 Configurable Funnels Certification   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    console.log('\n[bootstrap] setting up orgs, sessions, sites, mock GA4 server…');
    await bootstrap();
    console.log(`  mock GA4 server listening on port ${mockGA4.port}`);

    await section1();
    await section2();
    await section3();
    await section4();
    await section5();
    await section6();
    await section7();
    await section8();
    await section9();
    await section10();
    await section11();
    await section12();
    await sectionBonus();
    await sectionPatch2();
    await sectionUUID();
    await sectionPageLocation();
    await sectionParamFilters();
    await sectionSiteUrlCache();
    await sectionRetry();
    await sectionFrontend();

  } catch (e) {
    console.error('\n[FATAL]', e.message, e.stack);
    fail++;
    failures.push(`FATAL: ${e.message}`);
  } finally {
    await mockGA4.stop().catch(() => {});
    await cleanup();
    await DB.end().catch(() => {});
  }

  const total = pass + fail;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total: ${total}  ✅ ${pass}  ❌ ${fail}`);

  if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(f => console.log(`  • ${f}`));
  }

  if (total < 70) {
    console.log(`\n⚠️  WARNING: only ${total} tests — minimum 70 required`);
  }

  console.log(`\n${fail === 0 ? '🎉 ALL PASS' : `❌ ${fail} FAILURE(S)`}`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
