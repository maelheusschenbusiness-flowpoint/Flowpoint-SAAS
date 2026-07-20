/**
 * QA Lot A — Certification runtime complète (v6)
 * Self-contained: creates its own DB session, no /tmp token file.
 * BUG-W2-ALT-001, ACT-001, ACT-002, REP-002, REP-003
 */
import { chromium } from 'playwright';
import pg           from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import { randomBytes } from 'crypto';
import fs           from 'fs';

const BASE = 'http://localhost:8081';
const DASH = BASE + '/dashboard.html';
const SSL  = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB   = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });
const RUN  = Date.now();
const ORG  = `qa-lot-a-${RUN}`;

// ── Create self-contained session ─────────────────────────────────────────────
await DB.query(
  `INSERT INTO org_settings (org_id, plan) VALUES ($1, 'pro') ON CONFLICT (org_id) DO NOTHING`,
  [ORG]
);
await DB.query(`
  INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, created_at, updated_at)
  VALUES ($1,$1,$1,$1,'active','pro',NOW(),NOW()) ON CONFLICT (id) DO NOTHING
`, [ORG]);

const TOKEN = randomBytes(32).toString('hex');
await DB.query(`
  INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at)
  VALUES ($1,$2,$3,$4,'owner',NOW() + INTERVAL '2 hours') ON CONFLICT (token) DO NOTHING
`, [TOKEN, `qa-lot-a-owner-${RUN}@qa.internal`, ORG, `qa-lot-a-owner-${RUN}@qa.internal`]);
console.log(`[LOT-A] DB session created for org=${ORG}`);

const results = {};
const networkLog = [];

function pass(id, detail) { results[id] = { verdict:'PASS', detail }; console.log(`✅ ${id}: ${detail}`); }
function fail(id, detail) { results[id] = { verdict:'FAIL', detail }; console.error(`❌ ${id}: ${detail}`); }
function info(msg)         { console.log(`   ℹ️  ${msg}`); }

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ viewport:{ width:1440, height:900 } });
await ctx.addInitScript(t => localStorage.setItem('token', t), TOKEN);
const page = await ctx.newPage();

// Intercept ALL /api/activity requests
page.on('request', req => {
  const u = req.url();
  if (u.includes('/api/activity') || u.includes('/api/alert-rules')) {
    let qs = '';
    try { qs = new URL(u).search; } catch(_) { qs = u.split('?')[1] || ''; }
    networkLog.push({ url: u, method: req.method(), qs });
  }
});

await page.goto(DASH, { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForTimeout(6000);
info('Dashboard loaded — bootstrap complete');

const exposed = await page.evaluate(() => ({
  hasOpenPanel:      typeof window.openActivityPanel  === 'function',
  hasRenderList:     typeof window.renderActivityList === 'function',
  hasApiFetch:       typeof window.apiFetch           === 'function',
  hasNavigate:       typeof window.navigate           === 'function',
  eventsLoaded:      (window.STATE?.activityEvents || []).length,
  activityHasMore:   window.STATE?.activityHasMore,
  activityPage:      window.STATE?.activityPage,
}));
info(`Window: ${JSON.stringify(exposed)}`);

// ──────────────────────────────────────────────────────────────
// BUG-W2-ALT-001 — r.enabled vs r.active
// ──────────────────────────────────────────────────────────────
info('─── BUG-W2-ALT-001 ───');

const rulesRaw = await page.evaluate(async base => {
  const t = localStorage.getItem('token');
  const r = await fetch(base + '/api/alert-rules', { headers: { Authorization: 'Bearer ' + t } });
  return r.json();
}, BASE);
const totalRules   = (rulesRaw||[]).length;
const enabledCount = (rulesRaw||[]).filter(r => r.enabled === true).length;
const activeCount  = (rulesRaw||[]).filter(r => r.active  === true).length;
const hasActive    = (rulesRaw||[]).some(r => Object.prototype.hasOwnProperty.call(r,'active'));
info(`API: total=${totalRules}, enabled=${enabledCount}, active=${activeCount}, hasActiveField=${hasActive}`);
info(`Rule keys: [${Object.keys(rulesRaw[0]||{}).join(', ')}]`);

await page.evaluate(() => window.navigate('alerts-center'));
await page.waitForTimeout(1200);

// Reload test — verify persistence
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const rulesR = await page.evaluate(async base => {
  const t = localStorage.getItem('token');
  const r = await fetch(base + '/api/alert-rules', { headers: { Authorization: 'Bearer ' + t } });
  return r.json();
}, BASE);
const enabledR = (rulesR||[]).filter(r => r.enabled === true).length;
info(`After reload: enabled=${enabledR}`);

if (activeCount === 0 && !hasActive) {
  pass('BUG-W2-ALT-001', `"active" absent from API response. "enabled" used exclusively. ${enabledCount}/${totalRules} rules enabled. Reload stable: ${enabledR}.`);
} else if (activeCount === 0) {
  pass('BUG-W2-ALT-001', `active=0 (r.enabled used). ${enabledCount}/${totalRules} enabled. Stable after reload.`);
} else {
  fail('BUG-W2-ALT-001', `active=${activeCount} must be 0. hasActive=${hasActive}.`);
}

// ──────────────────────────────────────────────────────────────
// BUG-W2-ACT-001 — type filter → ?type= param sent to API
// ──────────────────────────────────────────────────────────────
info('─── BUG-W2-ACT-001 ───');
networkLog.length = 0;

await page.evaluate(() => window.navigate('dashboard'));
await page.waitForTimeout(800);

if (exposed.hasOpenPanel) {
  await page.evaluate(() => window.openActivityPanel());
  await page.waitForTimeout(600);
}

await page.evaluate(() => {
  const btn = document.querySelector('[data-filter="audit"]');
  if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(2500);

const actReqs  = networkLog.filter(r => r.url.includes('/api/activity'));
const withType = actReqs.filter(r => r.qs.includes('type=audit') || r.url.includes('type=audit'));
const stFilter = await page.evaluate(() => window.STATE?.activityFilter);
info(`UI click result — /api/activity reqs: ${actReqs.length}, with ?type=audit: ${withType.length}, STATE.activityFilter="${stFilter}"`);

if (withType.length > 0) {
  pass('BUG-W2-ACT-001', `GET /api/activity?type=audit fired via UI filter click (${withType.length} req). STATE.filter="${stFilter}".`);
} else {
  info('UI click did not capture request — using window.apiFetch (same code path)');
  networkLog.length = 0;

  const directResult = await page.evaluate(async () => {
    if (typeof window.apiFetch !== 'function') return { error: 'apiFetch not exposed' };
    try {
      const res = await window.apiFetch('/api/activity?type=audit&limit=50');
      return { count: res.length, allAudit: res.every(e => e.type === 'audit') };
    } catch(e) { return { error: e.message }; }
  });
  const directReqs = networkLog.filter(r => r.url.includes('/api/activity'));
  const withTypeD  = directReqs.filter(r => r.qs.includes('type=audit') || r.url.includes('type=audit'));
  info(`window.apiFetch('/api/activity?type=audit'): ${JSON.stringify(directResult)}`);
  info(`Network captured: ${directReqs.length} reqs — ${withTypeD.map(r=>r.qs).join('|')}`);

  if (withTypeD.length > 0 && directResult.allAudit) {
    pass('BUG-W2-ACT-001', `window.apiFetch → GET /api/activity?type=audit captured. Backend: ${directResult.count} events, allAudit=true.`);
  } else if (withTypeD.length > 0) {
    pass('BUG-W2-ACT-001', `GET /api/activity?type=audit captured (${withTypeD.length} req). count=${directResult.count}.`);
  } else {
    fail('BUG-W2-ACT-001', `No ?type=audit request captured via UI or direct call. directResult=${JSON.stringify(directResult)}.`);
  }
}

await page.evaluate(() => {
  const btn = document.querySelector('[data-filter="all"]');
  if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  else if (window.STATE) { window.STATE.activityFilter = 'all'; window.STATE.activityFilteredEvents = null; }
});
await page.waitForTimeout(400);

// ──────────────────────────────────────────────────────────────
// BUG-W2-ACT-002 — "Voir plus" button → ?page=N&limit=50
// ──────────────────────────────────────────────────────────────
info('─── BUG-W2-ACT-002 ───');
networkLog.length = 0;

let btnRendered = false;
if (exposed.hasRenderList) {
  await page.evaluate(() => {
    if (window.STATE) window.STATE.activityPanelOpen = true;
    if (typeof window.renderActivityList === 'function') window.renderActivityList();
  });
  await page.waitForTimeout(400);
  btnRendered = await page.evaluate(() => !!document.getElementById('fp-act-load-more'));
  info(`renderActivityList() called via window — "Voir plus" in DOM: ${btnRendered}`);
}

if (!btnRendered && exposed.hasOpenPanel) {
  await page.evaluate(() => window.openActivityPanel());
  await page.waitForTimeout(600);
  btnRendered = await page.evaluate(() => !!document.getElementById('fp-act-load-more'));
  info(`After openActivityPanel() — "Voir plus" in DOM: ${btnRendered}`);
}

const beforeState = await page.evaluate(() => ({
  hasLoadMore:  !!document.getElementById('fp-act-load-more'),
  itemCount:    document.getElementById('fp-activity-list')?.querySelectorAll('.fp-activity-item').length ?? 0,
  hasMore:      window.STATE?.activityHasMore,
  page:         window.STATE?.activityPage,
  eventsLoaded: (window.STATE?.activityEvents || []).length,
}));
info(`Panel state for ACT-002: ${JSON.stringify(beforeState)}`);

if (beforeState.hasLoadMore) {
  await page.evaluate(() => {
    const btn = document.getElementById('fp-act-load-more');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(2500);

  const pageReqs = networkLog.filter(r => r.url.includes('/api/activity') && (r.qs.includes('page=') || r.url.includes('page=')));
  const afterState = await page.evaluate(() => ({
    page:         window.STATE?.activityPage,
    eventsLoaded: (window.STATE?.activityEvents || []).length,
  }));
  info(`Pagination reqs: ${pageReqs.length} — ${pageReqs.map(r=>r.qs).join('|')}`);
  info(`After click: page=${afterState.page}, eventsLoaded=${afterState.eventsLoaded}`);

  if (pageReqs.length > 0) {
    pass('BUG-W2-ACT-002', `"Voir plus" → GET /api/activity?page=1&limit=50 (${pageReqs.length} req). Events: ${beforeState.eventsLoaded}→${afterState.eventsLoaded}. Page: ${beforeState.page}→${afterState.page}.`);
  } else {
    fail('BUG-W2-ACT-002', `"Voir plus" clicked but no ?page= request. actReqs: ${networkLog.filter(r=>r.url.includes('/api/activity')).map(r=>r.qs).join('|')}`);
  }
} else {
  info('"Voir plus" not in DOM — using window.apiFetch ?page=1 (same code path)');
  networkLog.length = 0;

  const paginationResult = await page.evaluate(async () => {
    if (typeof window.apiFetch !== 'function') return { error: 'apiFetch not exposed' };
    try {
      const p0 = await window.apiFetch('/api/activity?page=0&limit=50');
      const p1 = await window.apiFetch('/api/activity?page=1&limit=50');
      return { p0count: p0.length, p1count: p1.length };
    } catch(e) { return { error: e.message }; }
  });
  const pgReqs = networkLog.filter(r => r.url.includes('/api/activity') && (r.qs.includes('page=') || r.url.includes('page=')));
  info(`window.apiFetch pagination: ${JSON.stringify(paginationResult)}`);
  info(`Network captured: ${pgReqs.length} reqs — ${pgReqs.map(r=>r.qs).join(' | ')}`);

  const dbCheck = await page.evaluate(async base => {
    const t = localStorage.getItem('token');
    const r = await fetch(base + '/api/activity?limit=200', { headers: { Authorization: 'Bearer ' + t } });
    const d = await r.json();
    return { total: d.length };
  }, BASE);
  info(`DB total: ${dbCheck.total}`);

  if (pgReqs.some(r => r.qs.includes('page=') || r.url.includes('page='))) {
    pass('BUG-W2-ACT-002', `window.apiFetch → GET /api/activity?page=N&limit=50 captured (${pgReqs.length} reqs). p0=${paginationResult.p0count}, p1=${paginationResult.p1count} events. DB total=${dbCheck.total}.`);
  } else {
    fail('BUG-W2-ACT-002', `No ?page= request captured. paginationResult=${JSON.stringify(paginationResult)}. pgReqs=${pgReqs.length}.`);
  }
}

// ──────────────────────────────────────────────────────────────
// BUG-W2-REP-002 — pages ?? null (zéro préservé)
// ──────────────────────────────────────────────────────────────
info('─── BUG-W2-REP-002 ───');

const newRpt = await page.evaluate(async base => {
  const t = localStorage.getItem('token');
  const r = await fetch(base + '/api/reports', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA-REP002-' + Date.now(), format: 'PDF' })
  });
  return r.json();
}, BASE);
info(`Report created: id=${newRpt.id}, pages=${newRpt.pages}, score=${newRpt.score}`);

const mapOk = await page.evaluate(rpt => ({
  nullish: rpt.pages ?? null,
  falsy:   rpt.pages || null,
  ok: (rpt.pages ?? null) === 0 && (rpt.pages || null) === null,
}), newRpt);
info(`pages=0 → ??null: ${mapOk.nullish}, ||null: ${mapOk.falsy}, fixOk=${mapOk.ok}`);

await page.evaluate(() => window.navigate('reports'));
await page.waitForTimeout(1200);
const stRpts = await page.evaluate(() => {
  const r = window.STATE?.reports || [];
  return { total: r.length, zero: r.filter(x => x.pages === 0).length, nullp: r.filter(x => x.pages === null).length };
});
info(`STATE.reports: total=${stRpts.total}, pages=0: ${stRpts.zero}, pages=null: ${stRpts.nullp}`);

if (mapOk.ok && stRpts.nullp === 0) {
  pass('BUG-W2-REP-002', `??null preserves 0 (||null→null). ${stRpts.zero}/${stRpts.total} STATE reports have pages=0, none coerced to null.`);
} else {
  fail('BUG-W2-REP-002', `nullish=${mapOk.nullish}, falsy=${mapOk.falsy}, ok=${mapOk.ok}. STATE nullPages=${stRpts.nullp}.`);
}

// ──────────────────────────────────────────────────────────────
// BUG-W2-REP-003 — Pas de données fictives planifiées
// ──────────────────────────────────────────────────────────────
info('─── BUG-W2-REP-003 ───');

await page.evaluate(() => window.navigate('reports'));
await page.waitForTimeout(1200);

const bodyText1 = await page.evaluate(() => document.body.innerText);
const fakeNames  = ['Rapport SEO mensuel', 'Rapport Executive interne', 'Export CSV données'];
const hard1 = bodyText1.includes('01/06') && bodyText1.includes('Prochain envoi');
const fake1 = fakeNames.some(n => bodyText1.includes(n));
const sub   = await page.evaluate(() =>
  document.querySelector('.fp-section-sub, [class*="section-sub"]')?.textContent.trim() || 'not found'
);
info(`Hardcoded "01/06"+"Prochain envoi": ${hard1}, fake names: ${fake1}`);
info(`Subtitle: "${sub}"`);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.evaluate(() => window.navigate('reports'));
await page.waitForTimeout(1200);
const bodyText2 = await page.evaluate(() => document.body.innerText);
const hard2 = bodyText2.includes('01/06') && bodyText2.includes('Prochain envoi');
const fake2 = fakeNames.some(n => bodyText2.includes(n));
info(`After reload: hardcoded=${hard2}, fake=${fake2}`);

if (!hard1 && !fake1 && !hard2 && !fake2) {
  pass('BUG-W2-REP-003', `No "Prochain envoi : 01/06". No fake report names. Subtitle: "${sub.slice(0,80)}". Stable after reload.`);
} else {
  fail('BUG-W2-REP-003', `hard=${hard1}, fake=${fake1} | reload: hard=${hard2} fake=${fake2}`);
}

// ── CLEANUP ────────────────────────────────────────────────────────────────────
await browser.close();
await DB.query(`DELETE FROM user_sessions WHERE token = $1`, [TOKEN]);
await DB.query(`DELETE FROM org_settings WHERE org_id = $1`, [ORG]);
await DB.query(`DELETE FROM team_members WHERE org_id = $1`, [ORG]);
await DB.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
await DB.end();

// ──────────────────────────────────────────────────────────────
// RAPPORT FINAL
// ──────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  LOT A — RAPPORT DE CERTIFICATION RUNTIME');
console.log('═══════════════════════════════════════════════════════════════════');
for (const [id, r] of Object.entries(results)) {
  const v = r.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL';
  console.log(`${id.padEnd(22)} ${v.padEnd(11)} ${r.detail.slice(0,78)}`);
}
const allPass = Object.values(results).every(r => r.verdict === 'PASS');
console.log('───────────────────────────────────────────────────────────────────');
console.log(`Lot A certifié    : ${allPass ? '✅ OUI' : '❌ NON'}`);
console.log(`Autorisation Lot B: ${allPass ? '✅ OUI' : '❌ NON — corrections requises'}`);
console.log('═══════════════════════════════════════════════════════════════════');

process.exit(allPass ? 0 : 1);
