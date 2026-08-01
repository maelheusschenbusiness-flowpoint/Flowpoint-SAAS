'use strict';
/**
 * QA — AI Agents Phase 1 : registre de destinations (source de vérité unique)
 *
 * Run: node .local/qa_agent_destinations.cjs   (server must be running on 8081)
 *
 * PARTIE A — Validation statique registre ↔ frontend (échec = certification refusée)
 *   A1 — chaque route du registre existe dans le switch _doRender de dashboard.js
 *   A2 — chaque sub du registre existe dans SUB_NAVS[route]
 *   A3 — chaque ancre déclarée existe comme data-fp-anchor="…" dans dashboard.js
 *   A4 — chaque requiredPermission existe dans PERMISSION_CATALOG (permissions.ts)
 *   A5 — openModes ⊆ {page, tab, highlight} ; planGate ∈ {null, pro, ultra}
 *   A6 — ids uniques ; highlight ⟹ au moins une ancre déclarée
 *   A7 — prefill : specs typées valides (string/number/boolean, maxLength présent pour string)
 *
 * PARTIE B — GET /api/ai/destinations : filtrage permissions × plan
 *   B1 — owner (ultra)   : voit billing-* et settings-api/sso
 *   B2 — admin (ultra)   : idem owner
 *   B3 — member (ultra)  : ne voit AUCUN billing-* ni settings.admin
 *   B4 — viewer (ultra)  : idem member
 *   B5 — owner (standard): ne voit PAS local-seo* (planGate pro)
 *   B6 — owner (pro)     : voit local-seo*
 *   B7 — révocation org_member_permissions (audits.read) : destinations audits masquées
 *   B8 — réponse contient version + plan + jamais requiredPermission/planGate exposés
 */

const http = require('http');
const fs = require('fs');
const { Client } = require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || '';
const RUN = Date.now();
const WS = '/home/runner/workspace';

const registry = JSON.parse(fs.readFileSync(WS + '/artifacts/api-server/src/agent/destinations.json', 'utf8'));
const dashboard = fs.readFileSync(WS + '/artifacts/flowpoint-export/dashboard.js', 'utf8');
const permsSrc = fs.readFileSync(WS + '/artifacts/api-server/src/agent/permissions.ts', 'utf8');

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

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE A — validation statique
// ─────────────────────────────────────────────────────────────────────────────
function staticChecks() {
  console.log('── PARTIE A : registre ↔ frontend (statique) ──');
  const dests = registry.destinations;

  // A6a — unicité des ids
  const ids = dests.map(d => d.id);
  check('A6a ids uniques (' + ids.length + ' destinations)', new Set(ids).size === ids.length);

  // Extraire le bloc SUB_NAVS
  const snStart = dashboard.indexOf('const SUB_NAVS = {');
  const snEnd = dashboard.indexOf('\n};', snStart);
  const subNavsBlock = dashboard.slice(snStart, snEnd);

  // Extraire PERMISSION_CATALOG
  const pcStart = permsSrc.indexOf('PERMISSION_CATALOG = [');
  const pcEnd = permsSrc.indexOf(']', pcStart);
  const catalog = [...permsSrc.slice(pcStart, pcEnd).matchAll(/"([a-z.]+)"/g)].map(m => m[1]);
  check('A4a PERMISSION_CATALOG extrait (' + catalog.length + ' permissions)', catalog.length >= 15);

  const VALID_MODES = ['page', 'tab', 'highlight'];
  const VALID_GATES = [null, 'pro', 'ultra'];
  // Alias de routes gérés par le switch _doRender (redirections légitimes)
  const ROUTE_ALIASES = { integrations: true, automations: true, addons: true };

  for (const d of dests) {
    // A1 — route dans le switch _doRender (case 'route':)
    const routeOk = dashboard.includes("case '" + d.route + "':") || ROUTE_ALIASES[d.route];
    check("A1 route '" + d.route + "' (" + d.id + ') dans _doRender', routeOk);

    // A2 — sub déclaré dans SUB_NAVS[route]
    if (d.sub) {
      const routeLineMatch = subNavsBlock.split('\n').find(l => l.trim().startsWith("'" + d.route + "':"));
      const subOk = !!routeLineMatch && routeLineMatch.includes("id:'" + d.sub + "'");
      check("A2 sub '" + d.sub + "' (" + d.id + ") dans SUB_NAVS['" + d.route + "']", subOk);
    }

    // A3 — ancres présentes dans le DOM rendu
    for (const a of d.anchors || []) {
      check("A3 ancre '" + a + "' (" + d.id + ') présente comme data-fp-anchor', dashboard.includes('data-fp-anchor="' + a + '"'));
    }

    // A4 — permission connue
    check("A4 permission '" + d.requiredPermission + "' (" + d.id + ') au catalogue', catalog.includes(d.requiredPermission));

    // A5 — openModes/planGate valides
    check('A5 openModes valides (' + d.id + ')', Array.isArray(d.openModes) && d.openModes.length > 0 && d.openModes.every(m => VALID_MODES.includes(m)), d.openModes);
    check('A5 planGate valide (' + d.id + ')', VALID_GATES.includes(d.planGate), d.planGate);

    // A6b — highlight ⟹ ancres déclarées
    if ((d.openModes || []).includes('highlight')) {
      check('A6b highlight ⟹ ancre déclarée (' + d.id + ')', (d.anchors || []).length > 0);
    }

    // A7 — specs prefill typées
    if (d.prefill) {
      for (const [field, spec] of Object.entries(d.prefill)) {
        const typeOk = ['string', 'number', 'boolean'].includes(spec.type);
        const strOk = spec.type !== 'string' || typeof spec.maxLength === 'number';
        check('A7 prefill ' + d.id + '.' + field + ' typé', typeOk && strOk, spec);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE B — API filtrage permissions × plan
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n══ QA AI Agents Phase 1 — Registre de destinations (' + RUN + ') ══\n');
  staticChecks();

  console.log('\n── PARTIE B : GET /api/ai/destinations (permissions × plan) ──');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  const ORG_ULTRA = 'qa-agdest-ultra-' + RUN;
  const ORG_STD   = 'qa-agdest-std-' + RUN;
  const ORG_PRO   = 'qa-agdest-pro-' + RUN;
  const tokens = {};

  try {
    for (const [org, plan] of [[ORG_ULTRA, 'ultra'], [ORG_STD, 'standard'], [ORG_PRO, 'pro']]) {
      await c.query(
        `INSERT INTO org_settings (org_id, plan, email, created_at, updated_at)
         VALUES ($1,$2,'qa-agdest@test.fp',NOW(),NOW()) ON CONFLICT (org_id) DO NOTHING`, [org, plan]);
    }
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const token = crypto.randomBytes(32).toString('hex');
      await c.query(
        `INSERT INTO user_sessions (token, user_id, org_id, email, role, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW() + INTERVAL '1 hour')`,
        [token, 'qa-agdest-' + role + '-' + RUN, ORG_ULTRA, 'qa-agdest-' + role + '@test.fp', role]);
      tokens[role] = token;
    }
    for (const [key, org] of [['ownerStd', ORG_STD], ['ownerPro', ORG_PRO]]) {
      const token = crypto.randomBytes(32).toString('hex');
      await c.query(
        `INSERT INTO user_sessions (token, user_id, org_id, email, role, created_at, expires_at)
         VALUES ($1,$2,$3,'qa-agdest-' || $2 || '@test.fp','owner',NOW(),NOW() + INTERVAL '1 hour')`,
        [token, 'qa-agdest-' + key + '-' + RUN, org]);
      tokens[key] = token;
    }

    const ADMIN_ONLY = registry.destinations.filter(d => ['settings.admin', 'billing.read'].includes(d.requiredPermission)).map(d => d.id);
    const LOCAL_SEO = registry.destinations.filter(d => d.planGate === 'pro').map(d => d.id);
    const AUDIT_IDS = registry.destinations.filter(d => d.requiredPermission === 'audits.read').map(d => d.id);

    const idsOf = r => (r.body.destinations || []).map(d => d.id);

    // B1/B2 — owner + admin voient tout (plan ultra)
    for (const role of ['owner', 'admin']) {
      const r = await req('GET', '/api/ai/destinations', tokens[role]);
      const ids = idsOf(r);
      check('B1/B2 ' + role + ' (ultra) → 200 + billing/admin visibles', r.status === 200 && ADMIN_ONLY.every(id => ids.includes(id)), { status: r.status, missing: ADMIN_ONLY.filter(id => !ids.includes(id)) });
      check('B1/B2 ' + role + ' (ultra) voit local-seo (plan ok)', LOCAL_SEO.every(id => ids.includes(id)));
    }

    // B3/B4 — member + viewer ne voient ni billing ni settings.admin
    for (const role of ['member', 'viewer']) {
      const r = await req('GET', '/api/ai/destinations', tokens[role]);
      const ids = idsOf(r);
      check('B3/B4 ' + role + ' → 200 sans billing/settings.admin', r.status === 200 && ADMIN_ONLY.every(id => !ids.includes(id)), { status: r.status, leaked: ADMIN_ONLY.filter(id => ids.includes(id)) });
      check('B3/B4 ' + role + ' garde les destinations de lecture (missions/audits)', ids.includes('missions-list') && ids.includes('audits-list'));
    }

    // B5 — plan standard : local-seo masqué
    let r = await req('GET', '/api/ai/destinations', tokens.ownerStd);
    check('B5 owner (standard) ne voit pas local-seo*', r.status === 200 && LOCAL_SEO.every(id => !idsOf(r).includes(id)), { status: r.status, leaked: LOCAL_SEO.filter(id => idsOf(r).includes(id)) });
    check('B5 plan retourné = standard', r.body.plan === 'standard', r.body.plan);

    // B6 — plan pro : local-seo visible
    r = await req('GET', '/api/ai/destinations', tokens.ownerPro);
    check('B6 owner (pro) voit local-seo*', r.status === 200 && LOCAL_SEO.every(id => idsOf(r).includes(id)));

    // B7 — révocation ciblée : audits.read retiré au member → destinations audits masquées
    await c.query(
      `INSERT INTO org_member_permissions (org_id, user_id, permission, mode, created_at)
       VALUES ($1,$2,'audits.read','revoke',NOW())`,
      [ORG_ULTRA, 'qa-agdest-member-' + RUN]);
    r = await req('GET', '/api/ai/destinations', tokens.member);
    check('B7 member révoqué audits.read → destinations audits masquées', r.status === 200 && AUDIT_IDS.every(id => !idsOf(r).includes(id)), { leaked: AUDIT_IDS.filter(id => idsOf(r).includes(id)) });
    check('B7 les autres destinations restent visibles (missions)', idsOf(r).includes('missions-list'));

    // B8 — la réponse n'expose ni requiredPermission ni planGate + version présente
    r = await req('GET', '/api/ai/destinations', tokens.owner);
    const first = (r.body.destinations || [])[0] || {};
    check('B8 version présente', typeof r.body.version === 'number', r.body.version);
    check('B8 requiredPermission/planGate non exposés', !('requiredPermission' in first) && !('planGate' in first), Object.keys(first));
  } finally {
    await c.query(`DELETE FROM user_sessions WHERE org_id LIKE 'qa-agdest-%-' || $1`, [String(RUN)]).catch(() => {});
    await c.query(`DELETE FROM org_member_permissions WHERE org_id LIKE 'qa-agdest-%-' || $1`, [String(RUN)]).catch(() => {});
    await c.query(`DELETE FROM org_settings WHERE org_id LIKE 'qa-agdest-%-' || $1`, [String(RUN)]).catch(() => {});
    await c.end();
  }

  console.log('\n══ Résultat : ' + passed + ' ✓ / ' + failed + ' ✗ ══');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
