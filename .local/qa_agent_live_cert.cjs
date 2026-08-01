'use strict';
/**
 * QA — AI Agents Phase 1 : certification LIVE providers × rôles
 *
 * Run: node .local/qa_agent_live_cert.cjs   (server on 8081, vraies clés API)
 *
 * Matrice : 3 providers (openai, anthropic, gemini) × questions ciblées.
 * Pour chaque appel SSE, on vérifie :
 *   C1 — le marqueur <<<FP_NAV>>> / <<<END_NAV>>> n'apparaît JAMAIS dans les deltas
 *   C2 — si action_proposal émise : 1-2 actions max, destinationId ∈ registre,
 *        label ≤ 60 chars, proposalId + expiresAt présents
 *   C3 — la proposition est journalisée dans ai_action_proposals (traçabilité)
 *   C4 — _ai final présent (provider/model) — flux existant intact
 *   C5 — question navigation « voir mes audits » → proposition attendue (≥1 provider)
 *   C6 — viewer : jamais de proposition vers billing-* ou settings.admin
 *   C7 — GET /ai/conversations/:id/timeline retourne messages + proposals
 */

const http = require('http');
const fs = require('fs');
const { Client } = require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || '';
const RUN = Date.now();
const WS = '/home/runner/workspace';
const registry = JSON.parse(fs.readFileSync(WS + '/artifacts/api-server/src/agent/destinations.json', 'utf8'));
const KNOWN_IDS = new Set(registry.destinations.map(d => d.id));
const ADMIN_ONLY = new Set(registry.destinations.filter(d => ['settings.admin', 'billing.read'].includes(d.requiredPermission)).map(d => d.id));

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  ✓', label); passed++; }
  else { console.error('  ✗', label, detail !== undefined ? '— got: ' + JSON.stringify(detail).slice(0, 300) : ''); failed++; }
}

function sseChat(token, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const r = http.request({
      hostname: 'localhost', port: 8081, path: '/api/ai/chat', method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload), Accept: 'text/event-stream',
      },
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        const out = { status: res.statusCode, deltas: '', proposal: null, ai: null, error: null, rawEvents: [] };
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const p = t.slice(5).trim();
          if (p === '[DONE]') continue;
          try {
            const obj = JSON.parse(p);
            out.rawEvents.push(Object.keys(obj)[0]);
            if (obj.delta) out.deltas += obj.delta;
            if (obj.action_proposal) out.proposal = obj.action_proposal;
            if (obj._ai) out.ai = obj._ai;
            if (obj.error) out.error = obj.error;
          } catch {}
        }
        if (res.statusCode !== 200) out.error = raw.slice(0, 300);
        resolve(out);
      });
    });
    r.setTimeout(timeoutMs || 90000, () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

function getJson(path, token) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: 'localhost', port: 8081, path, method: 'GET', headers: { Authorization: 'Bearer ' + token } }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on('error', reject);
    r.end();
  });
}

function auditStream(tag, out, opts) {
  opts = opts || {};
  // C1 — marqueur jamais visible
  const leaked = out.deltas.includes('<<<FP_NAV') || out.deltas.includes('END_NAV>>>') || out.deltas.includes('<<<END_NAV');
  check('C1 ' + tag + ' — aucun marqueur dans les deltas', !leaked, out.deltas.slice(-200));
  // C4 — _ai présent
  check('C4 ' + tag + ' — _ai final présent (provider=' + (out.ai && out.ai.provider) + ')', !!(out.ai && out.ai.provider), out.error);
  // C2 — validité de la proposition si présente
  if (out.proposal) {
    const acts = out.proposal.actions || [];
    check('C2 ' + tag + ' — 1-2 actions max', acts.length >= 1 && acts.length <= 2, acts.length);
    check('C2 ' + tag + ' — destinations connues du registre', acts.every(a => KNOWN_IDS.has(a.destinationId)), acts.map(a => a.destinationId));
    check('C2 ' + tag + ' — labels ≤ 60 chars', acts.every(a => typeof a.label === 'string' && a.label.length <= 60));
    check('C2 ' + tag + ' — proposalId + expiresAt présents', !!out.proposal.proposalId && !!out.proposal.expiresAt);
    if (opts.forbidAdminOnly) {
      check('C6 ' + tag + ' — viewer : aucune destination billing/admin', acts.every(a => !ADMIN_ONLY.has(a.destinationId)), acts.map(a => a.destinationId));
    }
  }
  return out.proposal;
}

(async () => {
  console.log('\n══ QA AI Agents Phase 1 — Certification live (' + RUN + ') ══\n');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  const ORG = 'qa-agcert-' + RUN;
  const tokens = {};
  try {
    await c.query(
      `INSERT INTO org_settings (org_id, plan, email, created_at, updated_at)
       VALUES ($1,'ultra','qa-agcert@test.fp',NOW(),NOW()) ON CONFLICT (org_id) DO NOTHING`, [ORG]);
    for (const role of ['owner', 'viewer']) {
      const token = crypto.randomBytes(32).toString('hex');
      await c.query(
        `INSERT INTO user_sessions (token, user_id, org_id, email, role, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW() + INTERVAL '1 hour')`,
        [token, 'qa-agcert-' + role + '-' + RUN, ORG, 'qa-agcert-' + role + '@test.fp', role]);
      tokens[role] = token;
    }

    const NAV_Q = 'Où est-ce que je peux voir la liste de mes audits SEO ? Guide-moi.';
    const GEN_Q = 'Explique-moi en une phrase ce qu\'est le SEO.';
    const providers = ['openai', 'anthropic', 'gemini'];
    let navProposals = 0;

    for (const provider of providers) {
      console.log('── Provider : ' + provider + ' ──');
      const convId = 'conv_qacert_' + provider + '_' + RUN;

      // Question navigation (owner)
      let out = await sseChat(tokens.owner, { message: NAV_Q, stream: true, provider, conversationId: convId });
      check('C0 ' + provider + ' nav → HTTP 200', out.status === 200, out.status + ' ' + (out.error || ''));
      const prop = auditStream(provider + '/nav', out);
      if (prop) {
        navProposals++;
        // C3 — traçabilité DB
        const row = await c.query(`SELECT id, status, conversation_id FROM ai_action_proposals WHERE id = $1`, [prop.proposalId]);
        check('C3 ' + provider + ' — proposition journalisée en DB', row.rows.length === 1 && row.rows[0].status === 'proposed', row.rows);
        check('C3 ' + provider + ' — conversationId cohérent', row.rows.length === 1 && row.rows[0].conversation_id === convId, row.rows[0] && row.rows[0].conversation_id);
      } else {
        console.log('  · ' + provider + ' n\'a pas émis de proposition sur la question nav (toléré si ≥1 provider le fait)');
      }

      // Question générique (owner) — pas d'exigence de proposition, marqueur jamais visible
      out = await sseChat(tokens.owner, { message: GEN_Q, stream: true, provider, conversationId: convId });
      check('C0 ' + provider + ' générique → HTTP 200', out.status === 200, out.status + ' ' + (out.error || ''));
      auditStream(provider + '/générique', out);

      // C7 — timeline de conversation
      const tl = await getJson('/api/ai/conversations/' + convId + '/timeline', tokens.owner);
      check('C7 ' + provider + ' — timeline 200 + messages présents', tl.status === 200 && Array.isArray(tl.body.messages) && tl.body.messages.length >= 2, tl.status);
      if (prop) {
        check('C7 ' + provider + ' — timeline contient la proposition', (tl.body.proposals || []).some(p => p.id === prop.proposalId), (tl.body.proposals || []).map(p => p.id));
      }
    }

    // C5 — au moins un provider doit produire une proposition sur la question nav
    check('C5 — ≥1 provider a émis une proposition de navigation valide', navProposals >= 1, navProposals);

    // C6 — viewer sur une question billing : jamais de destination admin/billing
    const outV = await sseChat(tokens.viewer, { message: 'Où puis-je consulter mes factures et mon abonnement ?', stream: true, provider: 'openai', conversationId: 'conv_qacert_viewer_' + RUN });
    check('C0 viewer → HTTP 200', outV.status === 200, outV.status + ' ' + (outV.error || ''));
    auditStream('openai/viewer-billing', outV, { forbidAdminOnly: true });
  } finally {
    await c.query(`DELETE FROM ai_action_proposals WHERE org_id = 'qa-agcert-' || $1`, [String(RUN)]).catch(() => {});
    await c.query(`DELETE FROM ai_chat_history WHERE org_id = 'qa-agcert-' || $1`, [String(RUN)]).catch(() => {});
    await c.query(`DELETE FROM user_sessions WHERE org_id = 'qa-agcert-' || $1`, [String(RUN)]).catch(() => {});
    await c.query(`DELETE FROM org_settings WHERE org_id = 'qa-agcert-' || $1`, [String(RUN)]).catch(() => {});
    await c.end();
  }

  console.log('\n══ Résultat : ' + passed + ' ✓ / ' + failed + ' ✗ ══');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
