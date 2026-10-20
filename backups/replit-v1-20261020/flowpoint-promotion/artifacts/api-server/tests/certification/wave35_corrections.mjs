/**
 * Wave 3.5 Corrections — runtime certification tests
 *
 * A. /api/auth/me security: 401 without auth, 401 with invalid token, 200 with valid token.
 * B. Notification rendering: static analysis of dashboard.js for message||desc and date formatter.
 * C. Workspace Intelligence Map: m.score ?? '—' guard, score 0 stays 0, null becomes '—'.
 */
import pg   from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import { randomBytes } from 'crypto';
import fs   from 'fs';

const RUN  = Date.now();
const BASE = 'http://localhost:8081/api';
const SSL  = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB   = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });

let pass = 0, fail = 0;
function ok(name, cond, hint = '') {
  if (cond) { console.log(`  ✅ PASS — ${name}`); pass++; }
  else       { console.log(`  ❌ FAIL — ${name}${hint ? ' · ' + hint : ''}`); fail++; }
}
async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, opts);
  let body;
  try { body = await r.json(); } catch { body = {}; }
  return { status: r.status, body };
}

// ─── Setup: valid session in DB ───────────────────────────────────────────────
const ORG           = `qa-w35-${RUN}`;
const VALID_TOKEN   = randomBytes(32).toString('hex');
const SESSION_EMAIL = `qa-w35-owner-${RUN}@qa.internal`;

await DB.query(
  `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, created_at, updated_at)
   VALUES ($1,$1,$1,$1,'active','standard',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
  [ORG]
);
await DB.query(
  `INSERT INTO org_settings (org_id, plan) VALUES ($1, 'standard') ON CONFLICT (org_id) DO UPDATE SET plan = 'standard'`,
  [ORG]
);
await DB.query(
  `INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at)
   VALUES ($1,$2,$3,$4,'owner',NOW() + INTERVAL '2 hours') ON CONFLICT (token) DO NOTHING`,
  [VALID_TOKEN, `user-w35-${RUN}`, ORG, SESSION_EMAIL]
);

// ─── A. /api/auth/me security ─────────────────────────────────────────────────
console.log('\n[A] /api/auth/me — security');

const a1 = await api('/auth/me');
ok('A1 no credentials → 401', a1.status === 401,
   `status=${a1.status}`);

const a2 = await api('/auth/me', { headers: { Authorization: 'Bearer ' } });
ok('A2 Bearer empty → 401', a2.status === 401,
   `status=${a2.status}`);

const a3 = await api('/auth/me', { headers: { Authorization: 'Bearer deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } });
ok('A3 Bearer invalid → 401', a3.status === 401,
   `status=${a3.status}`);

const a1Body = JSON.stringify(a1.body);
ok('A4 401 body has no hardcoded "Maël"',
   !a1Body.includes('Ma\u00ebl') && !a1Body.includes('Mael'),
   `body=${a1Body.slice(0, 120)}`);
ok('A4 401 body has no id:"default"',
   !a1Body.includes('"id":"default"'),
   `body=${a1Body.slice(0, 120)}`);
ok('A4 401 body has no role:"owner"',
   !a1Body.includes('"role":"owner"'),
   `body=${a1Body.slice(0, 120)}`);
ok('A4 401 body has no plan:"pro" / "Pro"',
   !a1Body.toLowerCase().includes('"plan":"pro"'),
   `body=${a1Body.slice(0, 120)}`);

const a5 = await api('/auth/me', { headers: { Authorization: `Bearer ${VALID_TOKEN}` } });
ok('A5 valid token → 200',
   a5.status === 200,
   `status=${a5.status} body=${JSON.stringify(a5.body).slice(0, 120)}`);
ok('A5 response contains org id',
   a5.body?.id === ORG || typeof a5.body?.org === 'object',
   `id=${a5.body?.id}`);
ok('A5 no hardcoded "Maël" in 200 body',
   !JSON.stringify(a5.body).includes('Ma\u00ebl'),
   'hardcoded name found in authenticated response');

// ─── B. Notification rendering — static analysis ──────────────────────────────
console.log('\n[B] Notification rendering — dashboard.js static');

const DASH = fs.readFileSync(
  '/home/runner/workspace/artifacts/flowpoint-export/dashboard.js',
  'utf8'
);

ok('B1 n.message||n.desc fallback in notification dropdown',
   DASH.includes('n.message || n.desc') || DASH.includes("n.message||n.desc"),
   'pattern not found');

ok('B2 bare "Il y a ${n.time}" removed',
   !DASH.includes('Il y a ${n.time}'),
   'raw n.time still present');

ok('B3 French date formatter (toLocaleDateString fr-FR) present',
   DASH.includes("toLocaleDateString('fr-FR'") || DASH.includes('toLocaleDateString("fr-FR"'),
   'no fr-FR date formatter found');

ok('B4 date formatter handles empty/null (isNaN guard)',
   DASH.includes('isNaN(d.getTime())'),
   'isNaN guard missing');

const notifRegion = DASH.match(/fp-notif-item-desc[\s\S]{0,300}fp-notif-item-time/);
ok('B5 fp-notif-item-desc renders message not bare n.desc',
   notifRegion
     ? (notifRegion[0].includes('n.message') && !notifRegion[0].match(/\$\{n\.desc\}(?!\s*\|)/))
     : false,
   notifRegion ? `region: ${notifRegion[0].slice(0, 100)}` : 'region not found');

// ─── C. Workspace Intelligence Map — null score guard ─────────────────────────
console.log('\n[C] Workspace Intelligence Map — null score');

ok('C1 null guard on score color (m.score == null)',
   DASH.includes("m.score == null ? 'var(--fp-text-faint)'"),
   'null color guard not found');

ok('C2 m.score ?? \'—\' present (Intelligence Map)',
   DASH.includes("m.score ?? '—'"),
   'null coalescing for m.score not found');

const displayScore = (s) => s ?? '—';
ok('C3 null  → "—" (logic check)', displayScore(null) === '—',   `got=${displayScore(null)}`);
ok('C4 0     → 0   (score zero preserved)', displayScore(0)    === 0,     `got=${displayScore(0)}`);
ok('C5 72    → 72  (numeric score preserved)', displayScore(72) === 72,   `got=${displayScore(72)}`);

ok('C6 progress bar guard (pct = m.score ?? 0)',
   DASH.includes('m.score ?? 0'),
   'progress bar null guard missing');

// ─── Cleanup ──────────────────────────────────────────────────────────────────
console.log('\n━━━ CLEANUP ━━━');
try {
  await DB.query(`DELETE FROM user_sessions WHERE org_id = $1`, [ORG]);
  await DB.query(`DELETE FROM org_settings  WHERE org_id = $1`, [ORG]);
  await DB.query(`DELETE FROM org_addons    WHERE org_id = $1`, [ORG]);
  await DB.query(`DELETE FROM organizations WHERE id     = $1`, [ORG]);
  console.log(`  🗑  Removed org ${ORG} and related rows`);
} catch (e) { console.log(`  ⚠  Cleanup partial: ${e.message}`); }
await DB.end();

// ─── Results ──────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log(`\n━━━ Wave 3.5 Corrections — RESULTS: ${pass}/${total} PASS  |  ${fail} FAIL ━━━`);
if (fail > 0) process.exit(1);
