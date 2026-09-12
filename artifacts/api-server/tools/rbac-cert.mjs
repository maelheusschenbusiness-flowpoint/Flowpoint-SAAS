#!/usr/bin/env node
/**
 * RBAC Certification Script — FlowPoint
 * Tests all 4 roles (owner/admin/member/viewer) against every guarded mutation
 * and a representative set of GET endpoints.
 *
 * Usage:
 *   ADMIN_KEY=xxx BASE_URL=https://app.flowpoint.pro node rbac-cert.mjs
 *   ADMIN_KEY=xxx BASE_URL=http://localhost:8081 node rbac-cert.mjs
 */

const BASE_URL  = process.env.BASE_URL  || 'http://localhost:8081';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

if (!ADMIN_KEY) { console.error('❌  Set ADMIN_KEY env var'); process.exit(1); }

// ── helpers ────────────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const pass  = (msg) => console.log(`  ${GREEN}✅ PASS${RESET}  ${msg}`);
const fail  = (msg) => { console.log(`  ${RED}❌ FAIL${RESET}  ${msg}`); failures++; };
const skip  = (msg) => console.log(`  ${YELLOW}⚠️  SKIP${RESET}  ${DIM}${msg}${RESET}`);
let failures = 0;

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function mkSession(orgId, role) {
  const res = await fetch(`${BASE_URL}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
    body: JSON.stringify({ orgId, role, ttlMinutes: 5 }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`test-session failed for role=${role}: ${t}`);
  }
  const j = await res.json();
  return j.token;
}

// ── test cases ─────────────────────────────────────────────────────────────────
// Each entry: { label, method, path, body, guard }
// guard: 'canWrite'|'canAdmin'|'ownerOnly' — determines expected status per role
const TESTS = [
  // ── Audits ─────────────────────────────────────────────────────────────────
  { label:'POST /audits',                  method:'POST',   path:'/audits',                    body:{url:'https://example.com',force:false},        guard:'canWrite'  },
  { label:'DELETE /audits/:id (fake)',      method:'DELETE', path:'/audits/rbac-test-fake-id',  body:null,                                            guard:'canAdmin'  },
  // ── Monitors ───────────────────────────────────────────────────────────────
  { label:'POST /monitors',                method:'POST',   path:'/monitors',                  body:{url:'https://example.com',name:'test'},          guard:'canWrite'  },
  { label:'DELETE /monitors/:id (fake)',    method:'DELETE', path:'/monitors/rbac-test-fake-id',body:null,                                            guard:'canAdmin'  },
  // ── Reports ────────────────────────────────────────────────────────────────
  { label:'POST /reports',                 method:'POST',   path:'/reports',                   body:{name:'RBAC Test',type:'seo'},                    guard:'canWrite'  },
  { label:'POST /reports/send-invoice',    method:'POST',   path:'/reports/send-invoice',      body:{reportId:'fake'},                               guard:'canAdmin'  },
  // ── Missions ───────────────────────────────────────────────────────────────
  { label:'POST /missions',                method:'POST',   path:'/missions',                  body:{title:'RBAC Test',url:'https://example.com'},    guard:'canWrite'  },
  { label:'DELETE /missions/:id (fake)',    method:'DELETE', path:'/missions/rbac-test-fake-id',body:null,                                            guard:'canWrite'  },
  // ── Competitors ────────────────────────────────────────────────────────────
  { label:'POST /competitors',             method:'POST',   path:'/competitors',               body:{domain:'rbac-test.com'},                         guard:'canWrite'  },
  { label:'DELETE /competitors/:id (fake)',method:'DELETE', path:'/competitors/rbac-test-fake-id',body:null,                                         guard:'canWrite'  },
  // ── SEO / Local SEO ────────────────────────────────────────────────────────
  { label:'POST /seo/generate-missions',   method:'POST',   path:'/seo/generate-missions',     body:{url:'https://example.com'},                      guard:'canWrite'  },
  { label:'POST /local-seo/rankings',      method:'POST',   path:'/local-seo/rankings',        body:{keyword:'test',location:'Paris'},                guard:'canWrite'  },
  // ── Team / Invitations ─────────────────────────────────────────────────────
  { label:'POST /team/invite',             method:'POST',   path:'/team/invite',               body:{email:'rbac-invite@test.com',role:'viewer'},      guard:'canAdmin'  },
  { label:'DELETE /team/invitations/:id',  method:'DELETE', path:'/team/invitations/rbac-fake',body:null,                                             guard:'canAdmin'  },
  // ── Billing ────────────────────────────────────────────────────────────────
  { label:'POST /billing/checkout',        method:'POST',   path:'/billing/checkout',          body:{plan:'pro'},                                     guard:'ownerOnly' },
  { label:'POST /billing/trial',           method:'POST',   path:'/billing/trial',             body:{plan:'pro'},                                     guard:'ownerOnly' },
  { label:'POST /billing/addon-checkout',  method:'POST',   path:'/billing/addon-checkout',    body:{addonKey:'customDomain'},                        guard:'ownerOnly' },
  { label:'POST /billing/coupon/validate', method:'POST',   path:'/billing/coupon/validate',   body:{code:'TEST'},                                    guard:'canAdmin'  },
  { label:'POST /billing/usage-events',    method:'POST',   path:'/billing/usage-events',      body:{kind:'export'},                                  guard:'canWrite'  },
  // ── Settings / Org ─────────────────────────────────────────────────────────
  { label:'PATCH /org',                    method:'PATCH',  path:'/org',                       body:{name:'RBAC Test Org'},                           guard:'canAdmin'  },
  { label:'PUT /me/addons',                method:'PUT',    path:'/me/addons',                 body:{customDomain:true},                              guard:'ownerOnly' },
  { label:'PATCH /me/settings',            method:'PATCH',  path:'/me/settings',               body:{timezone:'UTC'},                                 guard:'canAdmin'  },
  { label:'POST /me/dataforseo/credentials',method:'POST', path:'/me/dataforseo/credentials', body:{login:'x',password:'x'},                         guard:'canAdmin'  },
  { label:'DELETE /settings/data',         method:'DELETE', path:'/settings/data',             body:null,                                             guard:'ownerOnly' },
  { label:'POST /settings/api-keys/regenerate',method:'POST',path:'/settings/api-keys/regenerate',body:{},                                           guard:'ownerOnly' },
];

// Expected status by guard × role
// canWrite  = owner/admin/member ✓  viewer ✗ (403)
// canAdmin  = owner/admin ✓  member/viewer ✗ (403)
// ownerOnly = owner ✓  admin/member/viewer ✗ (403)
// Note: we accept anything except 401/403 as "allowed" (the handler may 404/409/400 on fake IDs)
const EXPECTED = {
  canWrite:  { owner:'allow', admin:'allow', member:'allow', viewer:403 },
  canAdmin:  { owner:'allow', admin:'allow', member:403,     viewer:403 },
  ownerOnly: { owner:'allow', admin:403,     member:403,     viewer:403 },
};

function isAllowed(status) {
  // 200-499 except 401/403 = the role guard passed (handler ran; may legitimately 404/400/409)
  return status !== 401 && status !== 403;
}

// ── Read-only spot-checks (all roles must get 200-ish, never 403) ─────────────
const GET_TESTS = [
  { label:'GET /audits',       path:'/audits'       },
  { label:'GET /monitors',     path:'/monitors'     },
  { label:'GET /reports',      path:'/reports'      },
  { label:'GET /me',           path:'/me'           },
];

// ── Main ───────────────────────────────────────────────────────────────────────
// Must be a UUID so test-session creates the organizations row (requireAuth rejects non-UUID orgs)
import { randomUUID } from 'node:crypto';
const ORG_ID = randomUUID();
console.log(`\n${BOLD}FlowPoint RBAC Certification${RESET}`);
console.log(`Base URL : ${BASE_URL}`);
console.log(`Test org : ${ORG_ID}\n`);

// Create one session per role (shared org so data context is same)
let tokens;
try {
  tokens = {
    owner:  await mkSession(ORG_ID, 'owner'),
    admin:  await mkSession(ORG_ID, 'admin'),
    member: await mkSession(ORG_ID, 'member'),
    viewer: await mkSession(ORG_ID, 'viewer'),
  };
  console.log(`Sessions created for 4 roles ✓\n`);
} catch (err) {
  console.error(`${RED}Failed to create test sessions: ${err.message}${RESET}`);
  process.exit(1);
}

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const ROLE_LABEL = { owner:'Owner', admin:'Manager (admin)', member:'Editor (member)', viewer:'Viewer' };

// ── 1. Mutation guards ─────────────────────────────────────────────────────────
console.log(`${BOLD}── 1. Mutation guards ────────────────────────────────────────────${RESET}`);
for (const t of TESTS) {
  console.log(`\n  ${BOLD}${t.label}${RESET}  [${t.guard}]`);
  for (const role of ROLES) {
    const token = tokens[role];
    const status = await api(t.method, t.path, t.body, token);
    const expected = EXPECTED[t.guard][role];
    const label = `${ROLE_LABEL[role].padEnd(22)} → HTTP ${status}`;
    if (expected === 'allow') {
      if (isAllowed(status)) pass(label);
      else fail(`${label}  (expected: allowed, got 403/401 — RBAC too strict)`);
    } else {
      if (status === expected) pass(label);
      else fail(`${label}  (expected: ${expected}, got ${status} — RBAC too permissive!)`);
    }
  }
}

// ── 2. Read-only GET (all roles can read) ─────────────────────────────────────
console.log(`\n${BOLD}── 2. Read-only access (all roles must pass) ─────────────────────${RESET}`);
for (const t of GET_TESTS) {
  console.log(`\n  ${BOLD}${t.label}${RESET}`);
  for (const role of ROLES) {
    const status = await api('GET', t.path, null, tokens[role]);
    const label  = `${ROLE_LABEL[role].padEnd(22)} → HTTP ${status}`;
    if (isAllowed(status)) pass(label);
    else fail(`${label}  (all roles should be able to read)`);
  }
}

// ── Result ─────────────────────────────────────────────────────────────────────
const total = (TESTS.length * ROLES.length) + (GET_TESTS.length * ROLES.length);
console.log(`\n${BOLD}────────────────────────────────────────────────────────────────────${RESET}`);
if (failures === 0) {
  console.log(`${GREEN}${BOLD}✅  CERTIFIED — ${total}/${total} checks passed. RBAC is correct.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}❌  ${failures} failure(s) out of ${total} checks.${RESET}\n`);
  process.exit(1);
}
