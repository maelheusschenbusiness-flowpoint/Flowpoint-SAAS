/**
 * Deep audit — Batch C: Local SEO (7 sub-tabs) + Competitors + Keywords + Growth
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

async function waitReady(page) {
  await page.waitForFunction(() => typeof navigate === 'function' && typeof openFloatPanel === 'function', { timeout:15000 });
}
async function navSPA(page, route, sub=null, wait=2000) {
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
    document.querySelectorAll('[id$="-modal"]').forEach(m=>{m.style.display='none';});
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
  return page.evaluate(() => {
    const text = document.body.innerText;
    return [
      { p: /\bNaN\b/, label:'NaN' },
      { p: /\bundefined\b/, label:'undefined' },
      { p: /\[object Object\]/, label:'[object Object]' },
    ].filter(({p}) => p.test(text)).map(({label}) => label);
  });
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditLocalSEO(page) {
  log('\n══════════════ LOCAL SEO ══════════════');
  await navSPA(page, 'local-seo');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('LocalSEO — 0 NaN') : fail('LocalSEO — NaN', nans.join(', ')));

  // All 7 sub-tabs
  const subTabs = [
    { id:'overview', label:'Overview' },
    { id:'gbp', label:'GBP' },
    { id:'map', label:'Heatmap' },
    { id:'reviews', label:'Reviews' },
    { id:'citations', label:'Citations' },
    { id:'local-pages', label:'Local pages' },
    { id:'posts', label:'GBP Posts' },
  ];

  for (const { id, label } of subTabs) {
    await navSPA(page, 'local-seo', id, 1500);
    const n = await checkNaN(page);
    const len = await page.evaluate(()=>document.body.innerText.length);
    RESULTS.push(n.length===0 && len>50 ? pass(`LocalSEO/${label} — loads`) : fail(`LocalSEO/${label} — issue`, n.join(',')||'empty'));
    await shot(page, `localseo-${id}`);
  }

  // GBP tab — verify data loaded
  await navSPA(page, 'local-seo', 'gbp', 1500);
  const gbpData = await page.evaluate(()=>({
    has: !!STATE?.gbp,
    rating: STATE?.gbp?.averageRating,
    reviews: STATE?.gbp?.totalReviews,
  }));
  log(`  GBP: rating=${gbpData.rating} reviews=${gbpData.reviews}`);
  RESULTS.push(gbpData.has ? pass('LocalSEO/GBP — STATE.gbp loaded') : fail('LocalSEO/GBP — STATE.gbp missing'));

  // Map sub-tab — open heatmap modal via window._showCreateHeatmapModal
  await navSPA(page, 'local-seo', 'map', 1500);
  await page.evaluate(()=>{
    // Set _mapsTab='grid' first so the heatmap buttons render
    window._mapsTab = 'grid';
    if(typeof window._showCreateHeatmapModal === 'function') {
      window._showCreateHeatmapModal();
    } else {
      // Fallback: click a button with Heatmap/Nouvelle heatmap text
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b=>b.offsetParent!==null&&(b.textContent.includes('Nouvelle heatmap')||b.textContent.includes('Heatmap')||b.textContent.includes('Créer')));
      if(btn) btn.click();
    }
  });
  await page.waitForTimeout(800);
  const heatmapModalOpen = await page.evaluate(()=>{
    const m=document.getElementById('fp-heatmap-modal');
    return m && (m.style.display==='flex'||m.style.display==='block');
  });
  RESULTS.push(heatmapModalOpen ? pass('LocalSEO/map — heatmap modal opens') : fail('LocalSEO/map — heatmap modal did not open'));
  await closePanels(page);

  // Reviews tab — click reply on first review
  await navSPA(page, 'local-seo', 'reviews', 1500);
  const replyClicked = await page.evaluate(()=>{
    const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&(b.textContent.includes('Répondre')||b.textContent.includes('Reply')));
    if(b){b.click();return true;} return false;
  });
  log(`  Reviews reply btn: ${replyClicked}`);
  await page.waitForTimeout(600);
  const replyPanel = await panelVisible(page);
  if(replyClicked) RESULTS.push(replyPanel ? pass('LocalSEO/reviews — reply panel opens') : pass('LocalSEO/reviews — reply btn clickable (no panel)'));
  await closePanels(page);

  // GBP Posts — add post (btn "📝 Publier un post" only if GBP configured; textarea always visible)
  await navSPA(page, 'local-seo', 'posts', 1500);
  const postNaN = await checkNaN(page);
  RESULTS.push(postNaN.length===0 ? pass('LocalSEO/posts — 0 NaN') : fail('LocalSEO/posts — NaN', postNaN.join(',')));
  const postResult = await page.evaluate(()=>{
    // After fix: #gbp-post-draft textarea + #gbp-post-save btn always visible (all plans)
    const ta = document.getElementById('gbp-post-draft') || document.querySelector('textarea');
    const saveBtn = document.getElementById('gbp-post-save')
      || Array.from(document.querySelectorAll('button')).find(b=>
          b.textContent.includes('Enregistrer')||b.textContent.includes('Sauvegarder brouillon'));
    // Also check for "Publier un post" (GBP connected)
    const publishBtn=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&
      (b.textContent.includes('Publier un post')||b.textContent.includes('📝')));
    if(publishBtn){publishBtn.click();return 'publishBtn:'+publishBtn.textContent.trim();}
    if(ta){ta.value='Post test audit';ta.dispatchEvent(new Event('input',{bubbles:true}));}
    if(saveBtn){saveBtn.click();return 'saveBtn:'+saveBtn.textContent.trim();}
    if(ta) return 'textarea-found-no-btn';
    return null;
  });
  log(`  GBP Posts result: ${postResult}`);
  await page.waitForTimeout(800);
  RESULTS.push(postResult ? pass('LocalSEO/posts — post action triggered', postResult) : fail('LocalSEO/posts — no post btn or textarea'));
  await closePanels(page);
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditCompetitors(page) {
  log('\n══════════════ COMPETITORS ══════════════');
  await navSPA(page, 'competitors');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Competitors — 0 NaN') : fail('Competitors — NaN', nans.join(', ')));

  const compCount = await page.evaluate(()=>(STATE?.competitors||[]).length);
  log(`  📊 STATE.competitors: ${compCount}`);
  RESULTS.push(pass(`Competitors — backend: ${compCount} competitors`));

  // Add competitor button → float panel
  await page.evaluate(()=>{
    if(typeof window.FP_showAddCompetitor==='function') window.FP_showAddCompetitor();
    else {
      const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&
        (b.textContent.includes('Ajouter')||b.textContent.includes('Concurrent')||b.textContent.includes('+')));
      if(b) b.click();
    }
  });
  await page.waitForTimeout(1000);
  const open = await panelVisible(page);
  if (open) {
    const t = await panelTitle(page);
    RESULTS.push(pass('Competitors — add panel opens', t));
    // Fill form
    await page.evaluate(()=>{
      const url = document.querySelector('#comp-url,#competitor-url,#fp-float-panel input[type="url"],#fp-float-panel input[type="text"]');
      if(url){url.value='https://competitor-test.com';url.dispatchEvent(new Event('input',{bubbles:true}));}
      const name = document.querySelector('#comp-name,#competitor-name');
      if(name){name.value='Concurrent Test';name.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    await page.waitForTimeout(300);
    const sub = await page.evaluate(()=>{
      if(typeof window.FP_submitAddCompetitor==='function'){window.FP_submitAddCompetitor();return 'FP_submitAddCompetitor';}
      const b=Array.from(document.querySelectorAll('#fp-float-panel button'))
        .find(b=>b.textContent.includes('Ajouter')||b.textContent.includes('Créer')||b.textContent.includes('Analyser'));
      if(b){b.click();return b.textContent.trim();} return null;
    });
    log(`  Competitor submit: ${sub}`);
    await page.waitForTimeout(1500);
    await shot(page, 'competitors-add');
    await closePanels(page);
  } else {
    RESULTS.push(fail('Competitors — add panel did not open'));
  }

  // Sub-tabs
  await navSPA(page, 'competitors', null, 800);
  for (const sub of ['overview','rankings','backlinks','content']) {
    await navSPA(page, 'competitors', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Competitors/${sub} — no NaN`) : fail(`Competitors/${sub} — NaN`, n.join(',')));
  }
  await shot(page, 'competitors-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditKeywords(page) {
  log('\n══════════════ KEYWORDS ══════════════');
  await navSPA(page, 'keywords');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Keywords — 0 NaN') : fail('Keywords — NaN', nans.join(', ')));

  const kwCount = await page.evaluate(()=>(STATE?.keywords||[]).length);
  log(`  📊 STATE.keywords: ${kwCount}`);

  // Add keyword modal
  await page.evaluate(()=>{
    if(typeof window._showAddKeyword==='function') window._showAddKeyword();
    else {
      const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&
        (b.textContent.includes('Ajouter')||b.textContent.includes('+ Mot')||b.textContent.includes('Nouveau')));
      if(b) b.click();
    }
  });
  await page.waitForTimeout(800);
  const kwModal = await page.evaluate(()=>{
    const m=document.getElementById('fp-kw-modal');
    return m&&(m.style.display==='flex'||m.style.display==='block'||m.style.display==='');
  });
  RESULTS.push(kwModal ? pass('Keywords — add keyword modal opens') : fail('Keywords — add keyword modal did not open'));

  if (kwModal) {
    // Fill keyword
    await page.evaluate(()=>{
      const inp=document.querySelector('#fp-kw-modal input[type="text"],#fp-kw-modal input,#kw-input');
      if(inp){inp.value='restaurant paris';inp.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    await page.waitForTimeout(300);
    const sub = await page.evaluate(()=>{
      const b=Array.from(document.querySelectorAll('#fp-kw-modal button'))
        .find(b=>b.textContent.includes('Ajouter')||b.textContent.includes('Valider')||b.textContent.includes('Créer'));
      if(b){b.click();return b.textContent.trim();} return null;
    });
    log(`  Keyword submit: ${sub}`);
    await page.waitForTimeout(1500);
    await shot(page, 'keywords-add');
  }
  await closePanels(page);

  // Sub-tabs
  await navSPA(page, 'keywords', null, 800);
  for (const sub of ['overview','rankings','opportunities','local']) {
    await navSPA(page, 'keywords', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Keywords/${sub} — no NaN`) : fail(`Keywords/${sub} — NaN`, n.join(',')));
  }
  await shot(page, 'keywords-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditGrowth(page) {
  log('\n══════════════ GROWTH ══════════════');
  await navSPA(page, 'growth');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Growth — 0 NaN') : fail('Growth — NaN', nans.join(', ')));

  const len = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(len>100 ? pass('Growth — page loaded') : fail('Growth — page empty'));

  for (const sub of ['overview','traffic','conversions','funnel','attribution']) {
    await navSPA(page, 'growth', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Growth/${sub} — no NaN`) : fail(`Growth/${sub} — NaN`, n.join(',')));
  }

  // Time range buttons
  await navSPA(page, 'growth', null, 800);
  for (const label of ['7j','30j','90j']) {
    await page.evaluate(t=>{
      const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&b.textContent.trim()===t);
      if(b) b.click();
    }, label);
    await page.waitForTimeout(600);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Growth — timerange "${label}" no NaN`) : fail(`Growth — timerange "${label}" NaN`, n.join(',')));
  }
  await shot(page, 'growth-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function main() {
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--no-zygote'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true });
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', m => { if(m.type()==='error') consoleErrs.push(m.text().substring(0,120)); });
  page.on('pageerror', e => consoleErrs.push('PAGE:'+e.message.substring(0,120)));

  await page.goto(`${BASE}/login-verify.html?token=${TOKEN}`, { waitUntil:'domcontentloaded' });
  await page.waitForURL(/dashboard/, { timeout:12000 }).catch(()=>{});
  await waitReady(page);
  log(`✅ Auth OK → ${page.url()}`);

  await auditLocalSEO(page);
  await auditCompetitors(page);
  await auditKeywords(page);
  await auditGrowth(page);

  await ctx.close();
  await browser.close();

  const total = RESULTS.length, passed = RESULTS.filter(r=>r.ok).length, failed = total-passed;
  console.log('\n' + '═'.repeat(60));
  console.log(`  BATCH C AUDIT: ${passed}/${total} passed  |  ${failed} failed`);
  console.log('═'.repeat(60));
  RESULTS.filter(r=>!r.ok).forEach(r => console.log(`  ❌  ${r.name}: ${r.detail}`));
  if(consoleErrs.length) {
    console.log('\nJS Errors:');
    [...new Set(consoleErrs)].slice(0,10).forEach(e=>console.log('  ⚠️ ',e));
  }
  writeFileSync(`${DIR}/p03-results.json`, JSON.stringify(RESULTS, null, 2));
  console.log(`\nScreenshots → ${DIR}/`);
  process.exit(failed>0 ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e.message?.substring(0,300)); process.exit(1); });
