'use strict';
/**
 * QA — Correctif sécurité Keywords : contrôles de rôle sur les routes d'écriture
 *
 * Run: node .local/qa_keywords_rbac.cjs   (server must be running on 8081)
 *
 * Coverage:
 *   K01 — viewer  GET    /keywords            → 200 (lecture autorisée)
 *   K02 — viewer  POST   /keywords/track      → 403
 *   K03 — viewer  POST   /keywords/sync       → 403
 *   K04 — viewer  POST   /keywords            → 403
 *   K05 — viewer  PATCH  /keywords/:id        → 403
 *   K06 — viewer  DELETE /keywords/:id        → 403
 *   K07 — member  POST   /keywords            → 201
 *   K08 — admin   PATCH  /keywords/:id        → 200
 *   K09 — owner   DELETE /keywords/:id        → 200
 *   K10 — org B (owner) PATCH keyword org A   → 404 (isolation inter-org)
 *   K11 — org B (owner) DELETE keyword org A  → 404 (isolation inter-org)
 */

const http = require('http');
const { Client } = require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || '';
const RUN = Date.now();

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 8081, path, method,
      headers: {
        Authorization: 'Bearer ' + token, Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  ✓', label); passed++; }
  else { console.error('  ✗', label, detail !== undefined ? '— got: ' + JSON.stringify(detail) : ''); failed++; }
}

(async () => {
  console.log('\n══ QA Keywords RBAC (' + RUN + ') ══\n');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  const ORG_A = 'qa-kwrbac-a-' + RUN;
  const ORG_B = 'qa-kwrbac-b-' + RUN;
  const tokens = {};

  try {
    for (const org of [ORG_A, ORG_B]) {
      await c.query(
        `INSERT INTO org_settings (org_id, plan, email, created_at, updated_at)
         VALUES ($1,'ultra','qa-kw-' || $1 || '@test.fp',NOW(),NOW()) ON CONFLICT (org_id) DO NOTHING`, [org]);
    }
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const token = crypto.randomBytes(32).toString('hex');
      await c.query(
        `INSERT INTO user_sessions (token, user_id, org_id, email, role, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW() + INTERVAL '1 hour')`,
        [token, 'qa-kw-' + role + '-' + RUN, ORG_A, 'qa-kw-' + role + '@test.fp', role]);
      tokens[role] = token;
    }
    const tokenB = crypto.randomBytes(32).toString('hex');
    await c.query(
      `INSERT INTO user_sessions (token, user_id, org_id, email, role, created_at, expires_at)
       VALUES ($1,$2,$3,'qa-kw-bowner@test.fp','owner',NOW(),NOW() + INTERVAL '1 hour')`,
      [tokenB, 'qa-kw-bowner-' + RUN, ORG_B]);

    // Seed one keyword in org A (direct insert — bypasses HTTP for setup)
    const kwId = 'kw-qa-' + RUN;
    await c.query(
      `INSERT INTO tracked_keywords (id, org_id, keyword, active, device, location, language, created_at, updated_at)
       VALUES ($1,$2,$3,true,'desktop','France','fr',NOW(),NOW())`,
      [kwId, ORG_A, 'qa rbac keyword ' + RUN]);

    // ── Viewer : lecture OK, écritures 403 ──
    let r = await req('GET', '/api/keywords', tokens.viewer);
    check('K01 viewer GET /keywords → 200', r.status === 200, r.status);
    r = await req('POST', '/api/keywords/track', tokens.viewer, { keyword: 'blocked ' + RUN });
    check('K02 viewer POST /keywords/track → 403', r.status === 403, r.status);
    r = await req('POST', '/api/keywords/sync', tokens.viewer, {});
    check('K03 viewer POST /keywords/sync → 403', r.status === 403, r.status);
    r = await req('POST', '/api/keywords', tokens.viewer, { keyword: 'blocked2 ' + RUN });
    check('K04 viewer POST /keywords → 403', r.status === 403, r.status);
    r = await req('PATCH', '/api/keywords/' + kwId, tokens.viewer, { tag: 'hacked' });
    check('K05 viewer PATCH /keywords/:id → 403', r.status === 403, r.status);
    r = await req('DELETE', '/api/keywords/' + kwId, tokens.viewer);
    check('K06 viewer DELETE /keywords/:id → 403', r.status === 403, r.status);

    // ── Rôles autorisés ──
    r = await req('POST', '/api/keywords', tokens.member, { keyword: 'member kw ' + RUN });
    check('K07 member POST /keywords → 201', r.status === 201, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    r = await req('PATCH', '/api/keywords/' + kwId, tokens.admin, { tag: 'admin-tag' });
    check('K08 admin PATCH /keywords/:id → 200', r.status === 200, r.status);

    // ── Isolation inter-org (org B owner sur keyword org A) ──
    r = await req('PATCH', '/api/keywords/' + kwId, tokenB, { tag: 'cross-org' });
    check('K10 org B PATCH keyword org A → 404', r.status === 404, r.status);
    r = await req('DELETE', '/api/keywords/' + kwId, tokenB);
    check('K11 org B DELETE keyword org A → 404', r.status === 404, r.status);

    // owner delete (after cross-org attempts)
    r = await req('DELETE', '/api/keywords/' + kwId, tokens.owner);
    check('K09 owner DELETE /keywords/:id → 200', r.status === 200, r.status);

  } finally {
    await c.query(`DELETE FROM tracked_keywords WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]).catch(() => {});
    await c.query(`DELETE FROM user_sessions WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]).catch(() => {});
    await c.query(`DELETE FROM org_settings WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]).catch(() => {});
    await c.end();
  }

  console.log('\n══ Résultat : ' + passed + ' ✓ / ' + failed + ' ✗ ══');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
