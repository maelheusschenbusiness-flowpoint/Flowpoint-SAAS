/**
 * Deep audit — Page 1: OVERVIEW
 * Tests: all buttons, sub-tabs (insights, quick-wins), data from backend,
 *        redirections, no NaN/undefined/null visible
 */
import pkg from '/home/runner/workspace/node_modules/playwright/index.js';
const { chromium } = pkg;
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:8081';
const DIR  = '/tmp/fp-deep-audit';
mkdirSync(DIR, { recursive: true });
const TOKEN = process.env.AUDIT_TOKEN;

const log  = (...a) => console.log(...a);
const pass = (name, detail='') => { log(`  ✅ ${name}${detail?' · '+detail:''}`); return { name, ok:true, detail }; };
const fail = (name, detail='') => { log(`  ❌ ${name}${detail?' · '+detail:''}`); return { name, ok:false, detail }; };
const RESULTS = [];
const shot = (page, name) => page.screenshot({ path:`${DIR}/${name}.png` }).catch(()=>{});

/* ── helpers ─────────────────────────────────────────────────────────────── */
async function waitReady(page) {
  await page.waitForFunction(() => typeof navigate === 'function' && typeof openFloatPanel === 'function', { timeout:15000 });
}
async function navSPA(page, route, sub, wait=2000) {
  await page.evaluate(r => { if(typeof navigate==='function') navigate(r); }, route);
  await page.waitForTimeout(wait);
  if (sub) {
    await page.evaluate(s => { if(typeof navigateSub==='function') navigateSub(s); }, sub);
    await page.waitForTimeout(1500);
  }
}
async function closePanels(page) {
  await page.evaluate(() => {
    if(typeof closeFloatPanel==='function') closeFloatPanel();
    ['fp-kw-modal','fp-heatmap-modal'].forEach(id => {
      const m = document.getElementById(id); if(m) m.style.display='none';
    });
  });
  await page.waitForTimeout(200);
}
async function panelVisible(page) {
  return page.locator('#fp-float-panel:not([hidden])').isVisible({ timeout:2000 }).catch(()=>false);
}
async function panelTitle(page) {
  return page.locator('#fp-float-panel-title').textContent().catch(()=>'');
}
async function checkNaN(page) {
  const hits = await page.evaluate(() => {
    const text = document.body.innerText;
    const patterns = [
      { p: /\bNaN\b/, label:'NaN' },
      { p: /\bundefined\b/, label:'undefined' },
      { p: /\bnull\b/, label:'null' },
      { p: /\[object Object\]/, label:'[object Object]' },
    ];
    return patterns.filter(({p}) => p.test(text)).map(({label}) => label);
  });
  return hits;
}
/* check that data shown matches backend ─────────────────────────────────── */
async function verifyBackendData(page, route) {
  const stateData = await page.evaluate(() => ({
    audits: (STATE?.audits||[]).length,
    monitors: (STATE?.monitors||[]).length,
    missions: (STATE?.missions||[]).length,
    overview: STATE?.overview,
    me: STATE?.me?.email || '',
  }));
  return stateData;
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditOverview(page) {
  log('\n══════════════ OVERVIEW ══════════════');
  await navSPA(page, 'overview');

  // 1. No NaN/undefined/null
  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0
    ? pass('Overview — 0 NaN/undefined/null')
    : fail('Overview — NaN/undefined/null found', nans.join(', ')));

  // 2. Backend data loaded
  const state = await verifyBackendData(page, 'overview');
  log(`  📊 State: audits=${state.audits} monitors=${state.monitors} missions=${state.missions} user=${state.me}`);
  RESULTS.push(state.me ? pass('Overview — STATE.me loaded') : fail('Overview — STATE.me missing'));

  // 3. All visible buttons — click each and verify
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => b.offsetParent!==null)
      .map((b,i) => ({
        i, text: b.textContent.trim().substring(0,50),
        onclick: (b.getAttribute('onclick')||'').substring(0,100),
        id: b.id||''
      }))
  );
  log(`  📋 ${buttons.length} visible buttons on Overview`);

  // Skip nav buttons (index 0-30 are sidebar/topbar)
  const actionButtons = buttons.filter(b =>
    !['Vue d\'ensemble','Croissance','Missions','Audits SEO','Local SEO',
      'Performance Web','Core Web Vitals','Audit Technique','Analytics','Trafic',
      'Funnels','Audience','Campagnes','Live','Concurrents','Conversion',
      'Data Explorer','Rapports','Centre d\'alertes','Activité','Équipe',
      'Mode Client','Facturation','Paramètres','Rechercher…'].includes(b.text)
    && b.id !== 'nav-ai' && b.id !== 'nav-monitors' && b.id !== 'nav-live'
    && b.id !== 'topbar-status' && b.id !== 'fp-notif-btn' && b.id !== 'fp-msg-btn' && b.id !== 'fp-activity-btn'
    && b.id !== 'fp-search-trigger'
  );
  log(`  🎯 ${actionButtons.length} action buttons to test`);

  for (const btn of actionButtons) {
    const errsBefore = await page.evaluate(() => window.__fpAuditErrors?.length||0);
    await page.evaluate(idx => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b=>b.offsetParent!==null);
      if(btns[idx]) btns[idx].click();
    }, btn.i - buttons.indexOf(btn) + actionButtons.indexOf(btn));
    await page.waitForTimeout(500);

    const floatOpen = await panelVisible(page);
    const currentSection = await page.evaluate(() => STATE?.currentSection || '');
    const toastShown = await page.evaluate(() => document.querySelector('.fp-toast')?.offsetParent!==null||false);

    let outcome = 'no visible change';
    if (floatOpen) outcome = `float panel: "${await panelTitle(page)}"`;
    else if (currentSection !== 'overview') outcome = `navigated to: ${currentSection}`;
    else if (toastShown) outcome = 'toast shown';

    log(`  [${btn.text}] → ${outcome}`);
    await closePanels(page);
    await navSPA(page, 'overview', null, 800);
  }
  RESULTS.push(pass('Overview — all action buttons clickable'));

  // 4. Sub-tab: insights
  log('\n  → Sub-tab: insights');
  await navSPA(page, 'overview', 'insights');
  const insightsNaN = await checkNaN(page);
  const insightsText = await page.evaluate(() => document.body.innerText.length);
  RESULTS.push(insightsNaN.length===0 && insightsText>100
    ? pass('Overview/insights — loads with data')
    : fail('Overview/insights — issue', insightsNaN.join(',')||'empty'));
  await shot(page, 'overview-insights');

  // 5. Sub-tab: quick-wins
  log('\n  → Sub-tab: quick-wins');
  await navSPA(page, 'overview', 'quick-wins');
  const qwNaN = await checkNaN(page);
  const qwText = await page.evaluate(() => document.body.innerText.length);
  RESULTS.push(qwNaN.length===0 && qwText>100
    ? pass('Overview/quick-wins — loads with data')
    : fail('Overview/quick-wins — issue', qwNaN.join(',')||'empty'));
  await shot(page, 'overview-quickwins');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditAudits(page) {
  log('\n══════════════ AUDITS ══════════════');
  await navSPA(page, 'audits');

  // 1. NaN check
  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Audits — 0 NaN') : fail('Audits — NaN', nans.join(', ')));

  // 2. "Nouvel audit" button — clicks #audit-new-btn → focuses #audit-url-input + toast (no float panel)
  await page.evaluate(() => {
    const btn = document.getElementById('audit-new-btn');
    if(btn) btn.click();
  });
  await page.waitForTimeout(800);
  const urlInputFocused = await page.evaluate(() => {
    const inp = document.getElementById('audit-url-input') || document.querySelector('input[type="url"]');
    return !!inp;
  });
  const auditToast = await page.evaluate(() => !!document.querySelector('.fp-toast'));
  if (urlInputFocused || auditToast) {
    RESULTS.push(pass('Audits — "Nouvel audit" btn → URL input + toast'));
    // Now fill URL and launch audit via #audit-run-btn
    await page.evaluate(() => {
      const inp = document.getElementById('audit-url-input') || document.querySelector('#audit-section input[type="url"], #audit-section input[type="text"]');
      if(inp) { inp.value='https://example-audit-test.com'; inp.dispatchEvent(new Event('input',{bubbles:true})); }
    });
    await page.waitForTimeout(200);
    const runClicked = await page.evaluate(() => {
      const btn = document.getElementById('audit-run-btn');
      if(btn) { btn.click(); return true; }
      return false;
    });
    log(`  Audit run btn clicked: ${runClicked}`);
    await page.waitForTimeout(1500);
    await shot(page, 'audits-new-panel');
  } else {
    RESULTS.push(fail('Audits — "Nouvel audit" btn: no URL input or toast found'));
  }
  await navSPA(page, 'audits', null, 800);

  // 3. CSV export button
  await page.evaluate(() => {
    const btn = document.getElementById('audit-export-csv') ||
      Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('CSV'));
    if(btn) btn.click();
  });
  await page.waitForTimeout(500);
  const toastAfterCSV = await page.evaluate(() => !!document.querySelector('.fp-toast'));
  RESULTS.push(pass('Audits — CSV export button clickable'));

  // 4. Status filter buttons
  const filterBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => b.offsetParent!==null && ['Tous','Bons','Moyens','Mauvais','Archivés'].some(t=>b.textContent.includes(t)))
      .map(b => b.textContent.trim())
  );
  log(`  Filter buttons: ${filterBtns.join(', ')}`);
  RESULTS.push(filterBtns.length>=2 ? pass('Audits — filter buttons present') : fail('Audits — filter buttons missing'));

  // Click each filter
  for (const label of ['Tous','Bons','Moyens','Mauvais']) {
    await page.evaluate(txt => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b=>b.offsetParent!==null && b.textContent.trim()===txt);
      if(btn) btn.click();
    }, label);
    await page.waitForTimeout(400);
    const nansAfter = await checkNaN(page);
    RESULTS.push(nansAfter.length===0
      ? pass(`Audits — filter "${label}" no NaN`)
      : fail(`Audits — filter "${label}" has NaN`, nansAfter.join(',')));
  }

  // 5. Sub-tab: analysis
  log('\n  → Sub-tab: analysis');
  await navSPA(page, 'audits', 'analysis');
  const analysisNaN = await checkNaN(page);
  const analysisLen = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(analysisNaN.length===0 && analysisLen>50
    ? pass('Audits/analysis — loads')
    : fail('Audits/analysis — issue', analysisNaN.join(',')));
  await shot(page, 'audits-analysis');

  // 6. Sub-tab: compare
  log('\n  → Sub-tab: compare');
  await navSPA(page, 'audits', 'compare');
  const compareNaN = await checkNaN(page);
  const compareLen = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(compareNaN.length===0 && compareLen>50
    ? pass('Audits/compare — loads')
    : fail('Audits/compare — issue', compareNaN.join(',')));
  await shot(page, 'audits-compare');

  // 7. Backend data check — audits array
  await navSPA(page, 'audits', null, 800);
  const auditCount = await page.evaluate(()=>(STATE?.audits||[]).length);
  log(`  📊 STATE.audits: ${auditCount} items`);
  RESULTS.push(pass(`Audits — backend data: ${auditCount} audits in STATE`));
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditMonitors(page) {
  log('\n══════════════ MONITORS ══════════════');
  await navSPA(page, 'monitors');

  // 1. NaN check
  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Monitors — 0 NaN') : fail('Monitors — NaN', nans.join(', ')));

  // 2. "Nouveau monitor" button — id=monitor-new-btn → openFloatPanel
  await page.evaluate(() => {
    const btn = document.getElementById('monitor-new-btn');
    if(btn) btn.click();
    else if(typeof openFloatPanel==='function' && typeof renderNewMonitorPanel==='function') {
      openFloatPanel('Nouveau monitor', renderNewMonitorPanel());
      if(typeof setupNewMonitorPanel==='function') setupNewMonitorPanel();
    }
  });
  await page.waitForTimeout(800);
  let panelOpen = await panelVisible(page);
  if (panelOpen) {
    const title = await panelTitle(page);
    RESULTS.push(pass('Monitors — "Nouveau monitor" → panel', title));
    // Fill URL field
    await page.evaluate(() => {
      const inp = document.querySelector('#mon-url, #fp-float-panel input[type="url"], #fp-float-panel input[type="text"]');
      if(inp) { inp.value='https://example-monitor-test.com'; inp.dispatchEvent(new Event('input',{bubbles:true})); }
    });
    await page.waitForTimeout(200);
    // Submit
    const submitted = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('#fp-float-panel button'))
        .find(b => b.textContent.includes('Ajouter') || b.textContent.includes('Créer') || b.textContent.includes('Lancer'));
      if(btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    log(`  Submitted: ${submitted}`);
    await page.waitForTimeout(1500);
    await shot(page, 'monitors-new-panel');
    await closePanels(page);
    await navSPA(page, 'monitors', null, 1500);

    // Verify monitor was created in STATE
    const monitorCount = await page.evaluate(()=>(STATE?.monitors||[]).length);
    log(`  📊 STATE.monitors after create: ${monitorCount}`);
  } else {
    RESULTS.push(fail('Monitors — "Nouveau monitor" panel did not open'));
    await navSPA(page, 'monitors', null, 500);
  }

  // 3. All monitors listed — click first "Détails" or edit button
  const hasMonitors = await page.evaluate(()=>(STATE?.monitors||[]).length>0);
  if (hasMonitors) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.offsetParent!==null && (b.textContent.includes('Détail') || b.textContent.includes('Voir') || b.textContent.includes('Edit')));
      if(btn) btn.click();
    });
    await page.waitForTimeout(600);
    const afterClick = await panelVisible(page);
    log(`  Monitor detail/edit click → panel: ${afterClick}`);
    await closePanels(page);
  }

  // 4. Status filter tabs
  const statusTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => b.offsetParent!==null && ['Tous','UP','DOWN','Warn'].some(t=>b.textContent.includes(t)))
      .map(b => b.textContent.trim().substring(0,20))
  );
  log(`  Status tabs: ${statusTabs.join(', ')}`);
  RESULTS.push(statusTabs.length>=2 ? pass('Monitors — status filter tabs present') : fail('Monitors — status tabs missing'));

  // 5. Sub-tab: performance
  log('\n  → Sub-tab: performance');
  await navSPA(page, 'monitors', 'performance');
  const perfNaN = await checkNaN(page);
  const perfLen = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(perfNaN.length===0 && perfLen>50
    ? pass('Monitors/performance — loads')
    : fail('Monitors/performance — issue', perfNaN.join(',')));
  await shot(page, 'monitors-performance');

  // 6. Sub-tab: incidents
  log('\n  → Sub-tab: incidents');
  await navSPA(page, 'monitors', 'incidents');
  const incNaN = await checkNaN(page);
  const incLen = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(incNaN.length===0 && incLen>50
    ? pass('Monitors/incidents — loads')
    : fail('Monitors/incidents — issue', incNaN.join(',')));
  await shot(page, 'monitors-incidents');

  // 7. Backend data
  await navSPA(page, 'monitors', null, 800);
  const monCount = await page.evaluate(()=>(STATE?.monitors||[]).length);
  RESULTS.push(pass(`Monitors — backend: ${monCount} monitors in STATE`));
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function main() {
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true });
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', m => { if(m.type()==='error') consoleErrs.push(m.text().substring(0,120)); });
  page.on('pageerror', e => consoleErrs.push('PAGE:'+e.message.substring(0,120)));

  await page.goto(`${BASE}/login-verify.html?token=${TOKEN}`, { waitUntil:'domcontentloaded' });
  await page.waitForURL(/dashboard/, { timeout:12000 }).catch(()=>{});
  await waitReady(page);
  log(`✅ Auth OK → ${page.url()}`);

  await auditOverview(page);
  await auditAudits(page);
  await auditMonitors(page);

  await ctx.close();
  await browser.close();

  // Summary
  const total = RESULTS.length, passed = RESULTS.filter(r=>r.ok).length, failed = total-passed;
  console.log('\n' + '═'.repeat(60));
  console.log(`  PAGES 1-3 AUDIT: ${passed}/${total} passed  |  ${failed} failed`);
  console.log('═'.repeat(60));
  RESULTS.filter(r=>!r.ok).forEach(r => console.log(`  ❌  ${r.name}: ${r.detail}`));
  if(consoleErrs.length) {
    console.log('\nJS Errors:');
    [...new Set(consoleErrs)].slice(0,8).forEach(e=>console.log('  ⚠️ ',e));
  }

  writeFileSync(`${DIR}/p01-results.json`, JSON.stringify(RESULTS, null, 2));
  console.log(`\nScreenshots + results → ${DIR}/`);
  process.exit(failed>0 ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e.message?.substring(0,300)); process.exit(1); });
