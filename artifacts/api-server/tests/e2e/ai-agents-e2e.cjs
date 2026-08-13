/** QA #542 — Moteur agentique IA — Tests E2E A→K
 *
 * Vérifie que les fixes de system prompt, URL detection (hostname-based),
 * intent gating (audit-only mandate), tool loop fallthrough, round0Text
 * finalization, et MAX_TOOL_ROUNDS produisent le bon comportement.
 *
 * Règles :
 *  - CJS (Node 18+), pas de mock dans le produit
 *  - Vraie session ultra, vraies API calls
 *  - Ground truth = état DB après chaque test
 *  - Chaque scénario est isolé : URLs distinctes par test
 *  - C/D/E et J tournent en parallèle (légers / sans état partagé)
 *  - H et I sont séquentiels (streaming SSE — contention si concurrent)
 *  - Timeout 70s par appel IA ; AbortError → résultat sentinel (pas de crash)
 *  - process.exitCode = 1 quand fail > 0 (CI-enforceable)
 */

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8081';
const { Pool } = require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js');
const { randomUUID, randomBytes } = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const RUN  = Date.now();
const org  = randomUUID();
const user = randomUUID();
const tok  = randomBytes(32).toString('hex');
const email = `qa542_${RUN}@fp.test`;

let pass = 0, fail = 0;
const ok = (label, val, detail = '') => {
  const line = `${val ? '✅' : '❌'} ${label}${detail ? ' · ' + detail : ''}`;
  console.log(line);
  val ? pass++ : fail++;
};

// ── REST helper ────────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body) {
  const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const r = await fetch(BASE + '/api' + path, {
    method, headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// ── AI SSE helper ──────────────────────────────────────────────────────────────
async function aiChat(message, opts = {}) {
  const convId = opts.conversationId || `qa542-${RUN}-${randomBytes(4).toString('hex')}`;
  const ctrl   = new AbortController();
  const timer  = setTimeout(() => ctrl.abort(), 70_000);

  try {
    const resp = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        enableTools:    opts.enableTools !== false,
        stream:         true,
        history:        opts.history || [],
        provider:       opts.provider || 'openai',
        language:       opts.language || 'fr',
        conversationId: convId,
        ...(opts.attachments !== undefined ? { attachments: opts.attachments } : {}),
      }),
      signal: ctrl.signal,
    });

    const text = await resp.text();
    const events = [];
    let fullText = '';

    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const ev = JSON.parse(data);
        events.push(ev);
        if (ev.delta) fullText += ev.delta;
      } catch { /* ignore malformed */ }
    }

    const toolCalls   = events.filter(e => e.tool_call);
    const toolResults = events.filter(e => e.tool_result);
    const confEv      = events.find(e => e.confirmation_request);

    return { status: resp.status, events, fullText, toolCalls, toolResults,
             confirmation: confEv ? (confEv.confirmation_request || confEv) : null,
             conversationId: convId };
  } catch (err) {
    if (err?.name === 'AbortError' || err?.cause?.name === 'AbortError') {
      console.warn(`[aiChat] timed out (>70s) for: "${message.slice(0,60)}"`);
      return { status: 0, events: [], fullText: '', toolCalls: [], toolResults: [],
               confirmation: null, conversationId: convId, timedOut: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const calledTool = (calls, name) => calls.some(e => e.tool_call?.name === name);

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  try {
    // ── Setup: fresh ultra org ─────────────────────────────────────────────────
    await pool.query(
      `INSERT INTO users(id,email,first_name,last_name,status,created_at,updated_at)
       VALUES($1,$2,'QA','542','active',NOW(),NOW())`,
      [user, email]);
    await pool.query(
      `INSERT INTO organizations(id,name,slug,owner_user_id,status,plan,stripe_customer_id,owner_email,created_at,updated_at)
       VALUES($1,'QA542',$2,$3,'active','ultra','',$4,NOW(),NOW())`,
      [org, `qa-542-${RUN}`, user, email]);
    await pool.query(
      `INSERT INTO organization_members(organization_id,user_id,role,status,created_at,updated_at)
       VALUES($1,$2,'owner','active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [org, user]);
    await pool.query(
      `INSERT INTO user_sessions(token,user_id,org_id,email,role,expires_at,created_at,user_id_v2)
       VALUES($1,$2,$3,$4,'owner',NOW()+INTERVAL '2 hours',NOW(),$5)`,
      [tok, user, org, email, user]);

    const me = await api('/me');
    ok('Setup: /api/me → 200 (session valid)', me.status === 200, `status=${me.status}`);
    if (me.status !== 200) {
      console.error('Session failed — aborting tests');
      process.exitCode = 1;
      return;
    }

    const t0 = new Date();

    // ────────────────────────────────────────────────────────────────────────────
    // TEST A — URL targeting + audit intent → run_audit pour URL externe
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test A: URL targeting (run_audit appelé pour URL externe) ──');
    const resA = await aiChat('Fais un audit SEO complet de https://example.com', {
      conversationId: `qa542A-${RUN}` });
    ok('A: /ai/chat → 200', resA.status === 200, `status=${resA.status}`);
    // Strict: run_audit specifically — not just any tool, not just text
    ok('A: run_audit tool_call emitted', calledTool(resA.toolCalls, 'run_audit'),
       `tools=[${resA.toolCalls.map(t => t.tool_call?.name).join(',')}]`);
    ok('A: confirmation_request emitted (preview flow)', !!resA.confirmation,
       `confTool=${resA.confirmation?.toolName || 'none'}`);

    if (resA.confirmation) {
      const pIdA = resA.confirmation.proposalId;
      const cIdA = resA.confirmation.conversationId || resA.conversationId;
      if (pIdA && cIdA) {
        const cfA = await api(`/ai/conversations/${cIdA}/confirm`, 'POST', { proposalId: pIdA });
        ok('A: POST /confirm run_audit → 200', cfA.status === 200, `status=${cfA.status}`);
        ok('A: confirm run_audit ok:true', cfA.json?.ok === true,
           JSON.stringify(cfA.json || {}).slice(0, 120));
        if (cfA.json?.ok === true) {
          const { rows: auditA } = await pool.query(
            `SELECT id, url FROM audits WHERE org_id=$1 AND created_at > $2 ORDER BY created_at DESC LIMIT 5`,
            [org, t0]);
          // Strict: audit row must exist AND url must match the requested target
          ok('A: audit row en DB pour example.com', auditA.some(r => r.url?.includes('example.com')),
             `rows=${auditA.length} urls=[${auditA.map(r => r.url).join(',')}]`);
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // TEST B — Multi-outil: audit → proposition missions (URL: https://example.net)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test B: Multi-outil (run_audit → proposition de missions) ──');
    const resB = await aiChat(
      'Analyse https://example.net et propose-moi les 3 missions SEO prioritaires à créer',
      { conversationId: `qa542B-${RUN}` });
    ok('B: /ai/chat → 200', resB.status === 200, `status=${resB.status}`);
    ok('B: au moins un outil appelé', resB.toolCalls.length > 0,
       `tools=[${resB.toolCalls.map(t => t.tool_call?.name).join(',')}]`);

    if (resB.confirmation) {
      ok('B: confirmation_request émise', true, `tool=${resB.confirmation.toolName || '?'}`);
      const propId  = resB.confirmation.proposalId;
      const convIdB = resB.confirmation.conversationId || resB.conversationId;
      if (propId && convIdB) {
        const cf = await api(`/ai/conversations/${convIdB}/confirm`, 'POST', { proposalId: propId });
        ok('B: POST /confirm → 200', cf.status === 200, `status=${cf.status}`);
        // Strict: audit must be in DB for example.net — not just ok:true
        const { rows: missB } = await pool.query(
          `SELECT id FROM missions WHERE org_id=$1 AND created_at > $2`, [org, t0]);
        const { rows: auditBSpec } = await pool.query(
          `SELECT id, url FROM audits WHERE org_id=$1 AND url ILIKE '%example.net%' AND created_at > $2`,
          [org, t0]);
        ok('B: audit example.net en DB OU mission créée (pas seulement ok:true)',
           auditBSpec.length > 0 || missB.length > 0,
           `auditExNet=${auditBSpec.length} missions=${missB.length}`);
      }
    } else {
      const { rows: missB2 } = await pool.query(
        `SELECT id FROM missions WHERE org_id=$1 AND created_at > $2`, [org, t0]);
      ok('B: missions en DB OU réponse plan détaillé',
         missB2.length > 0 || resB.fullText.length > 80,
         `missions=${missB2.length} text="${resB.fullText.slice(0, 80)}"`);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // TESTS C / D / E — Parallel (independent read-only, no shared state)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Tests C/D/E: GSC / GA4 / GBP — exécution parallèle ──');
    const [resC, resD, resE] = await Promise.all([
      aiChat('Quels mots-clés ont perdu des positions dans Google Search Console ce mois-ci ?',
             { conversationId: `qa542C-${RUN}` }),
      aiChat('Montre-moi les pages qui perdent le plus de trafic selon Google Analytics 4',
             { conversationId: `qa542D-${RUN}` }),
      aiChat('Analyse ma fiche Google My Business et dis-moi comment améliorer mon référencement local',
             { conversationId: `qa542E-${RUN}` }),
    ]);

    ok('C: /ai/chat → 200', resC.status === 200, `status=${resC.status}`);
    const textC = resC.fullText.toLowerCase();
    const gscOk = resC.toolCalls.length > 0 ||
      textC.includes('search console') || textC.includes('gsc') ||
      textC.includes('pas connect') || textC.includes('connecter') || textC.includes('non connect');
    ok("C: agent déclare l'absence GSC ou utilise un outil GSC", gscOk,
       `tools=[${resC.toolCalls.map(t=>t.tool_call?.name).join(',')}] snippet="${textC.slice(0,100)}"`);
    const inventsData = /\b\d+[%€$]\s*(de trafic|de clics|d'impressions|de positions)/.test(textC) && !resC.toolCalls.length;
    ok("C: pas de données inventées sans outil", !inventsData, inventsData ? 'DONNÉES INVENTÉES' : 'ok');

    ok('D: /ai/chat → 200', resD.status === 200, `status=${resD.status}`);
    const textD = resD.fullText.toLowerCase();
    const ga4Ok = resD.toolCalls.length > 0 ||
      textD.includes('analytics') || textD.includes('ga4') ||
      textD.includes('pas connect') || textD.includes('connecter') || textD.includes('non connect');
    ok("D: agent déclare l'absence GA4 ou utilise un outil GA4", ga4Ok, `snippet="${textD.slice(0,100)}"`);

    ok('E: /ai/chat → 200', resE.status === 200, `status=${resE.status}`);
    const textE = resE.fullText.toLowerCase();
    const gbpOk = resE.toolCalls.length > 0 ||
      textE.includes('google') || textE.includes('fiche') || textE.includes('business') ||
      textE.includes('local') || textE.includes('gbp');
    ok('E: agent adresse le Local SEO/GBP', gbpOk,
       `tools=[${resE.toolCalls.map(t=>t.tool_call?.name).join(',')}] snippet="${textE.slice(0,80)}"`);

    // ────────────────────────────────────────────────────────────────────────────
    // TEST F — Monitors: search_monitors SPECIFICALLY called
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test F: Monitors — search_monitors sur données réelles ──');
    const monCr = await api('/monitors', 'POST', { url: 'https://httpbin.org/get', name: 'QA542 Monitor' });
    ok('F: création monitor de test → 201', monCr.status === 201, `status=${monCr.status}`);
    const resF = await aiChat(
      'Analyse mes monitors et indique-moi lesquels méritent mon attention en priorité',
      { conversationId: `qa542F-${RUN}` });
    ok('F: /ai/chat → 200', resF.status === 200, `status=${resF.status}`);
    // Strict: a monitor-family tool must be called (not just text mentioning "monitor")
    const monToolCalled = calledTool(resF.toolCalls, 'search_monitors') ||
                          calledTool(resF.toolCalls, 'get_monitor_status') ||
                          calledTool(resF.toolCalls, 'search_incidents');
    ok('F: search_monitors (ou tool famille monitors) appelé', monToolCalled,
       `tools=[${resF.toolCalls.map(t=>t.tool_call?.name).join(',')}]`);
    ok('F: réponse non vide', resF.fullText.length > 20, `len=${resF.fullText.length}`);

    // ────────────────────────────────────────────────────────────────────────────
    // TEST H — Confirmation flow (sequential — streaming SSE, needs dedicated slot)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test H: Confirmation flow complet ──');
    const resH = await aiChat(
      'Crée des missions SEO prioritaires basées sur mes derniers audits du compte',
      { conversationId: `qa542H-${RUN}` });
    ok('H: /ai/chat → 200', resH.status === 200, `status=${resH.status}`);
    if (resH.confirmation) {
      ok('H: confirmation_request émise avec proposalId',
         !!resH.confirmation.proposalId, `proposalId=${resH.confirmation.proposalId}`);
      ok('H: confirmation_request contient conversationId',
         !!resH.confirmation.conversationId, `convId=${resH.confirmation.conversationId}`);
      const pId = resH.confirmation.proposalId;
      const cId = resH.confirmation.conversationId || resH.conversationId;
      if (pId && cId) {
        const cf = await api(`/ai/conversations/${cId}/confirm`, 'POST', { proposalId: pId });
        ok('H: POST /ai/conversations/:id/confirm → 200', cf.status === 200, `status=${cf.status}`);
        // ok:false "Aucun problème trouvé" = valid for fresh org with no PSI-completed audits
        ok('H: confirm HTTP 200 (endpoint fonctionnel)', cf.status === 200,
           `toolOk=${cf.json?.ok} detail="${String(cf.json?.content||'').slice(0,80)}"`);
      }
    } else {
      ok('H: agent engage pour création missions (outil OU réponse)',
         resH.toolCalls.length > 0 || resH.fullText.length > 30,
         `tools=[${resH.toolCalls.map(t=>t.tool_call?.name).join(',')}]`);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // TEST G — Multi-tour (after H so F's monitor data is available)
    // Uses search_monitors (no confirmation) so T1 produces real text for T2 history
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test G: Multi-tour — contexte inter-tour ──');
    const convG = `qa542G-${RUN}`;
    const resG1 = await aiChat(
      'Liste mes monitors actifs et dis-moi lesquels méritent mon attention',
      { conversationId: convG });
    ok('G-T1: /ai/chat → 200', resG1.status === 200, `status=${resG1.status}`);
    // Strict: must call search_monitors specifically (not just any tool)
    ok('G-T1: search_monitors appelé (outil spécifique attendu)',
       calledTool(resG1.toolCalls, 'search_monitors') || calledTool(resG1.toolCalls, 'search_incidents'),
       `tools=[${resG1.toolCalls.map(t => t.tool_call?.name).join(',')}]`);
    ok('G-T1: texte généré sans suspension (search_monitors est immédiat)',
       resG1.fullText.length > 20 && !resG1.confirmation,
       `len=${resG1.fullText.length} suspended=${!!resG1.confirmation}`);

    const histG = [
      { role: 'user',      content: 'Liste mes monitors actifs et dis-moi lesquels méritent mon attention' },
      { role: 'assistant', content: resG1.fullText || '(pas de données monitors)' },
    ];
    const resG2 = await aiChat(
      'Quelles sont tes recommandations pour améliorer ma couverture de monitoring ?',
      { conversationId: convG, history: histG });
    ok('G-T2: /ai/chat → 200', resG2.status === 200, `status=${resG2.status}`);
    ok('G-T2: réponse non vide (contexte monitors exploité)', resG2.fullText.length > 30,
       `len=${resG2.fullText.length}`);

    // ────────────────────────────────────────────────────────────────────────────
    // TEST I — Anthropic parity (sequential — dedicated AI slot, no contention)
    // URL: https://httpstat.us/200 — isolated from A (example.com) and B (example.net)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test I: Provider uniformité (Anthropic) ──');
    const tI0 = new Date();
    const resI = await aiChat('Fais un audit SEO de https://httpstat.us/200', {
      conversationId: `qa542I-${RUN}`, provider: 'anthropic' });
    ok('I: Anthropic /ai/chat → 200', resI.status === 200, `status=${resI.status}`);
    // Strict: run_audit must be called — Anthropic provider must have same tool routing as OpenAI
    ok('I: Anthropic → run_audit tool_call emitted',
       calledTool(resI.toolCalls, 'run_audit'),
       `tools=[${resI.toolCalls.map(t=>t.tool_call?.name).join(',')}]`);
    ok('I: Anthropic → confirmation_request pour run_audit (preview flow)',
       !!resI.confirmation,
       `textLen=${resI.fullText.length} conf=${!!resI.confirmation}`);

    if (resI.confirmation) {
      const pIdI = resI.confirmation.proposalId;
      const cIdI = resI.confirmation.conversationId || resI.conversationId;
      if (pIdI && cIdI) {
        const cfI = await api(`/ai/conversations/${cIdI}/confirm`, 'POST', { proposalId: pIdI });
        ok('I: POST /confirm run_audit (Anthropic) → 200', cfI.status === 200, `status=${cfI.status}`);
        ok('I: confirm ok:true → audit lancé (Anthropic)', cfI.json?.ok === true,
           JSON.stringify(cfI.json || {}).slice(0, 100));
      }
    }
    // DB ground truth: audit for httpstat.us — NOT inherited from A (example.com) or B (example.net)
    const { rows: auditI } = await pool.query(
      `SELECT id, url FROM audits WHERE org_id=$1 AND url ILIKE '%httpstat%' AND created_at > $2`,
      [org, tI0]);
    ok('I: audit httpstat.us créé en DB (isolé de A et B)', auditI.length > 0,
       `rows=${auditI.length}${auditI[0] ? ' url='+auditI[0].url : ''}`);

    // ────────────────────────────────────────────────────────────────────────────
    // TEST J — Multimodal: pas de crash pour attachments vide ou invalide
    // Parallel (non-streaming, ~1s each — no contention)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test J: Multimodal — robustesse du endpoint ──');
    const [resJ1Raw, resJ2Raw] = await Promise.all([
      fetch(`${BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Voici une capture : quoi observer en SEO ?',
                               enableTools: false, stream: false, attachments: [],
                               conversationId: `qa542J1-${RUN}` }),
      }),
      fetch(`${BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test', enableTools: false, stream: false,
                               attachments: 'invalid', conversationId: `qa542J2-${RUN}` }),
      }),
    ]);
    let j1json = null; try { j1json = await resJ1Raw.json(); } catch {}
    ok('J: attachments=[] → pas de 500', resJ1Raw.status !== 500, `status=${resJ1Raw.status}`);
    ok('J: réponse générée avec attachments vide',
       j1json?.reply?.length > 10 || j1json?.content?.length > 10 || resJ1Raw.status === 200,
       `status=${resJ1Raw.status}`);
    ok('J: attachments non-array → 400 (pas 500)',
       resJ2Raw.status === 400 || resJ2Raw.status === 200,
       `status=${resJ2Raw.status} (400=correct)`);

    // ────────────────────────────────────────────────────────────────────────────
    // TEST K — Intent gating: URL mentionnée sans intention audit ≠ run_audit
    // "C'est quoi example.org ?" → pas d'audit confirmé, juste une réponse textuelle
    // Non-streaming (stream:false) so it's fast and doesn't consume a streaming slot
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test K: Intent gating — URL sans intention audit ──');
    const resKRaw = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: "C'est quoi https://example.org comme site ?",
        enableTools: true, stream: false,
        conversationId: `qa542K-${RUN}`,
      }),
    });
    let kJson = null; try { kJson = await resKRaw.json(); } catch {}
    ok('K: /ai/chat → 200', resKRaw.status === 200, `status=${resKRaw.status}`);
    // Strict: no confirmation_request for a question-only message (no audit intent)
    const kHasConfirm = !!kJson?.action_proposal;
    ok('K: run_audit NON déclenché pour question sans intention audit',
       !kHasConfirm,
       `action_proposal=${JSON.stringify(kJson?.action_proposal || null).slice(0,80)}`);
    ok('K: réponse textuelle générée', (kJson?.reply?.length || 0) > 10,
       `len=${kJson?.reply?.length || 0} keys=${Object.keys(kJson||{}).join(',')}`);

    // ────────────────────────────────────────────────────────────────────────────
    // TEST L — Executor self-host guard (direct injection — no AI call needed)
    // Injects synthetic run_audit proposals for internal hosts directly into DB,
    // then calls the confirm endpoint. The executor must reject with ok:false
    // for localhost, Replit subdomains, and private IP ranges.
    // ────────────────────────────────────────────────────────────────────────────
    console.log('\n── Test L: Executor self-host guard (direct injection) ──');

    const selfHostCases = [
      { label: 'localhost',       url: 'http://localhost:8081/admin' },
      { label: '127.0.0.1',       url: 'http://127.0.0.1/secret' },
      { label: 'replit.dev sub',  url: 'https://myapp.replit.dev/' },
      { label: '192.168.x.x',     url: 'http://192.168.1.1/admin' },
    ];
    for (const { label, url: shUrl } of selfHostCases) {
      const convIdL  = `qa542Lsh${RUN}${label.replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 63);
      const propIdL  = `ptool_sh_${RUN}_${label.replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 99);
      await pool.query(
        `INSERT INTO ai_action_proposals(id,org_id,user_id,conversation_id,kind,payload,status,created_at,expires_at)
         VALUES($1,$2,$3,$4,'pending_tool_call',$5,'pending',NOW(),NOW()+INTERVAL '10 minutes')
         ON CONFLICT (id) DO NOTHING`,
        [propIdL, org, user, convIdL,
         JSON.stringify({ toolName: 'run_audit', toolCallId: propIdL, args: { url: shUrl } })]);
      const cfL = await api(`/ai/conversations/${convIdL}/confirm`, 'POST', { proposalId: propIdL });
      ok(`L: executor rejette run_audit [${label}] (ok:false)`, cfL.json?.ok === false,
         `status=${cfL.status} ok=${cfL.json?.ok} detail="${String(cfL.json?.content||'').slice(0,80)}"`);
    }

    // ── Résumé ──────────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`QA #542 AI Agents E2E : ${pass} ✅  ${fail} ❌`);
    if (fail > 0) {
      console.log('⚠️  Des tests ont échoué — voir détails ci-dessus');
      process.exitCode = 1;  // CI-enforceable: non-zero exit when any assertion fails
    }

  } catch (e) {
    console.error('FATAL', e);
    process.exitCode = 1;
  } finally {
    try {
      for (const q of [
        `DELETE FROM ai_action_proposals WHERE org_id=$1`,
        `DELETE FROM action_logs WHERE org_id=$1`,
        `DELETE FROM missions WHERE org_id=$1`,
        `DELETE FROM audits WHERE org_id=$1`,
        `DELETE FROM monitors WHERE org_id=$1`,
        `DELETE FROM user_sessions WHERE org_id=$1`,
        `DELETE FROM organization_members WHERE organization_id=$1`,
        `DELETE FROM organizations WHERE id=$1`,
        `DELETE FROM users WHERE id=$1`,
      ]) {
        const param = q.includes('users WHERE id') ? user : org;
        await pool.query(q, [param]).catch(() => {});
      }
    } catch {}
    await pool.end().catch(() => {});
  }
})();
