/**
 * TEST D — Gemini Chat Validation
 * 10+ questions variées via SSE streaming + non-streaming.
 * Crée un org de test avec preferredProvider='gemini', fait les appels, nettoie.
 */
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL;
const API    = 'http://127.0.0.1:8081';
const pool   = new Pool({ connectionString: DB_URL });
const RUN    = Date.now().toString(36);
const ORG_ID = `test-gemini-${RUN}`;
const TOKEN  = crypto.randomBytes(32).toString('hex');

// ── DB Setup ─────────────────────────────────────────────────────────────────
async function setup(client) {
  // Create org (Ultra so AI credits are unrestricted)
  await client.query(`
    INSERT INTO organizations (id, name, owner_email, owner_first_name, plan, subscription_status, created_at, updated_at)
    VALUES ($1,$2,$3,'GeminiTest','ultra','trialing',NOW(),NOW())
    ON CONFLICT (id) DO UPDATE SET plan='ultra', subscription_status='trialing'
  `, [ORG_ID, `Gemini Test ${RUN}`, `gemini-${RUN}@test.flowpoint`]);

  // Set preferredProvider = gemini in org_settings
  await client.query(`
    INSERT INTO org_settings (org_id, preferred_provider, ai_intensity)
    VALUES ($1,'gemini','standard')
    ON CONFLICT (org_id) DO UPDATE SET preferred_provider='gemini', ai_intensity='standard'
  `,[ORG_ID]);

  // Session
  const exp = new Date(Date.now() + 86400_000);
  await client.query(`
    INSERT INTO user_sessions (token,user_id,org_id,email,role,expires_at,created_at)
    VALUES ($1,$2,$3,$4,'owner',$5,NOW()) ON CONFLICT DO NOTHING
  `,[TOKEN, ORG_ID, ORG_ID, `gemini-${RUN}@test.flowpoint`, exp]);
}

async function cleanup(client) {
  await client.query(`DELETE FROM user_sessions WHERE org_id=$1`,[ORG_ID]).catch(()=>{});
  await client.query(`DELETE FROM org_settings WHERE org_id=$1`,[ORG_ID]).catch(()=>{});
  await client.query(`DELETE FROM organizations WHERE id=$1`,[ORG_ID]).catch(()=>{});
}

// ── SSE streaming reader ──────────────────────────────────────────────────────
async function chatStream(messages) {
  const t0 = Date.now();
  const resp = await fetch(`${API}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ message: messages[messages.length-1].content, stream: true }),
  });

  if (!resp.ok) {
    return { ok: false, httpStatus: resp.status, text: '', latencyMs: Date.now()-t0, chunks: 0, error: await resp.text().catch(()=>'') };
  }

  const reader = resp.body.getReader();
  const dec    = new TextDecoder();
  let buf = '';
  let fullText = '';
  let chunkCount = 0;
  let done = false;

  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) buf += dec.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') { done = true; break; }
      try {
        const parsed = JSON.parse(payload);
        if (parsed.delta) { fullText += parsed.delta; chunkCount++; }
        if (parsed.error) return { ok: false, httpStatus: resp.status, text: fullText, latencyMs: Date.now()-t0, chunks: chunkCount, error: parsed.error };
      } catch {}
    }
  }

  return { ok: true, httpStatus: resp.status, text: fullText, latencyMs: Date.now()-t0, chunks: chunkCount, error: null };
}

// ── Questions ─────────────────────────────────────────────────────────────────
const QUESTIONS = [
  'Bonjour, qui es-tu ?',
  'Explique-moi le référencement naturel en 3 phrases.',
  'Quels sont les 5 facteurs SEO les plus importants pour le référencement local en France ?',
  'Génère une liste numérotée des 7 balises HTML essentielles pour le SEO.',
  'Comment interpréter un score PageSpeed de 42/100 sur mobile ?',
  'Quelle est la différence entre un backlink dofollow et nofollow ?',
  'Donne-moi un exemple de balise title optimisée pour une boulangerie à Lyon.',
  'Comment améliorer le Core Web Vitals d\'un site e-commerce ?',
  'Qu\'est-ce que le schema markup LocalBusiness et comment l\'implémenter ?',
  'Résume en une phrase ce que je dois faire en priorité si mon score SEO est inférieur à 30/100.',
  'Quels outils recommandes-tu pour auditer une fiche Google Business Profile ?',
  'Quelle est la longueur idéale pour une méta-description en 2026 ?',
];

// ── Main ──────────────────────────────────────────────────────────────────────
const client = await pool.connect();
try {
  await setup(client);
  console.log(`\n✦ Org de test créé : ${ORG_ID}`);
  console.log(`✦ Provider configuré : gemini`);
  console.log(`✦ ${QUESTIONS.length} questions à poser\n`);
} finally {
  client.release();
}

const testResults = [];
const history = [];

for (let i = 0; i < QUESTIONS.length; i++) {
  const q = QUESTIONS[i];
  history.push({ role: 'user', content: q });
  process.stdout.write(`  Q${String(i+1).padStart(2,'0')} [${q.slice(0,45).replace(/\n/g,'↵')}…] → `);

  const res = await chatStream(history);

  const empty     = !res.text || res.text.trim().length === 0;
  const truncated = res.text && res.text.length > 0 && res.text.trim().slice(-1).match(/[,;:]/) && res.text.length < 30;
  const rawHtml   = /<\/?[a-z]+>/.test(res.text);
  const hasNewlines = /\n/.test(res.text);

  let verdict = 'PASS';
  const issues = [];
  if (!res.ok)      { verdict = 'FAIL'; issues.push(`HTTP ${res.httpStatus}`); }
  if (empty)        { verdict = 'FAIL'; issues.push('réponse vide'); }
  if (rawHtml)      { issues.push('HTML brut détecté'); }
  if (res.chunks === 0 && res.ok) { verdict = 'FAIL'; issues.push('0 chunks SSE'); }

  const preview = res.text ? res.text.slice(0,80).replace(/\n/g,'↵') + (res.text.length>80?'…':'') : '(vide)';
  console.log(`${verdict} | ${res.chunks} chunks | ${res.latencyMs}ms | "${preview}"`);
  if (issues.length) console.log(`     ⚠ Issues: ${issues.join(', ')}`);
  if (res.error)     console.log(`     ✗ Error: ${res.error}`);

  testResults.push({ q, verdict, ...res, empty, truncated, rawHtml, issues });

  // Add AI response to history for conversation continuity test
  if (res.text) history.push({ role: 'assistant', content: res.text });

  // Brief pause between calls
  await new Promise(r => setTimeout(r, 400));
}

// ── History continuity test ───────────────────────────────────────────────────
console.log('\n  Testing history continuity (follow-up on Q1)…');
const followUp = await chatStream([
  ...history,
  { role: 'user', content: 'En te basant sur ta première réponse, donne un mot-clé supplémentaire.' },
]);
const historyOk = followUp.ok && followUp.text.trim().length > 0;
console.log(`  History test: ${historyOk ? 'PASS ✅' : 'FAIL ❌'} — "${followUp.text.slice(0,80)}"`);

// ── Summary ───────────────────────────────────────────────────────────────────
const pass  = testResults.filter(r => r.verdict === 'PASS').length;
const fail  = testResults.filter(r => r.verdict === 'FAIL').length;
const empty = testResults.filter(r => r.empty).length;
const totalChunks = testResults.reduce((s,r) => s + r.chunks, 0);
const avgLatency  = Math.round(testResults.reduce((s,r) => s + r.latencyMs, 0) / testResults.length);

console.log('\n' + '═'.repeat(72));
console.log('  RAPPORT D — GEMINI');
console.log('═'.repeat(72));
console.log(`  Questions posées    : ${QUESTIONS.length}`);
console.log(`  PASS                : ${pass}`);
console.log(`  FAIL                : ${fail}`);
console.log(`  Réponses vides      : ${empty}`);
console.log(`  Total chunks SSE    : ${totalChunks}`);
console.log(`  Latence moyenne     : ${avgLatency}ms`);
console.log(`  Continuité historique: ${historyOk ? 'OK' : 'FAIL'}`);
console.log(`  HTML brut           : ${testResults.some(r=>r.rawHtml) ? 'OUI ⚠' : 'non'}`);
console.log(`  Verdict global      : ${fail === 0 && empty === 0 && historyOk ? 'PASS ✅' : 'FAIL ❌'}`);
console.log('═'.repeat(72));

// Cleanup
const cleanClient = await pool.connect();
try { await cleanup(cleanClient); } finally { cleanClient.release(); await pool.end(); }
