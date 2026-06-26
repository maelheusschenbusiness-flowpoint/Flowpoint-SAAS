/**
 * Deep audit — Batch D+E: Conversion, Forecast, Calendar, AI, CRM, Market Intel, Review Intel
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

async function auditPage(page, route, label, subTabs=[]) {
  log(`\n══════════════ ${label.toUpperCase()} ══════════════`);
  await navSPA(page, route);

  const nans = await checkNaN(page);
  const len = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(nans.length===0 && len>50 ? pass(`${label} — loads, 0 NaN`) : fail(`${label} — issue`, nans.join(',')||'empty'));
  await shot(page, route.replace('/','-'));

  for (const sub of subTabs) {
    await navSPA(page, route, sub, 1000);
    const n = await checkNaN(page);
    const l2 = await page.evaluate(()=>document.body.innerText.length);
    RESULTS.push(n.length===0 && l2>50 ? pass(`${label}/${sub} — loads`) : fail(`${label}/${sub} — issue`, n.join(',')||'empty'));
    await shot(page, `${route.replace('/','-')}-${sub}`);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditConversion(page) {
  log('\n══════════════ CONVERSION ══════════════');
  await navSPA(page, 'conversion');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Conversion — 0 NaN') : fail('Conversion — NaN', nans.join(',')));

  for (const sub of ['overview','funnel','heatmaps','sessions','ab-tests']) {
    await navSPA(page, 'conversion', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Conversion/${sub} — no NaN`) : fail(`Conversion/${sub} — NaN`, n.join(',')));
  }

  // AI conversion button
  await navSPA(page, 'conversion', null, 800);
  const aiBtn = await page.evaluate(()=>{
    const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&
      (b.textContent.includes('IA')||b.textContent.includes('Analyser')||b.textContent.includes('Optimiser')));
    if(b){b.click();return b.textContent.trim();} return null;
  });
  log(`  AI btn: ${aiBtn}`);
  await page.waitForTimeout(600);
  await closePanels(page);
  await shot(page, 'conversion-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditForecast(page) {
  log('\n══════════════ FORECAST ══════════════');
  await navSPA(page, 'forecast');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Forecast — 0 NaN') : fail('Forecast — NaN', nans.join(',')));

  const len = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(len>100 ? pass('Forecast — content loaded') : fail('Forecast — empty'));

  for (const sub of ['revenue','traffic','rankings','scenarios']) {
    await navSPA(page, 'forecast', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Forecast/${sub} — no NaN`) : fail(`Forecast/${sub} — NaN`, n.join(',')));
  }
  await shot(page, 'forecast-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditCalendar(page) {
  log('\n══════════════ CALENDAR ══════════════');
  await navSPA(page, 'calendar');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Calendar — 0 NaN') : fail('Calendar — NaN', nans.join(',')));

  // Add event: call openFloatPanel directly, check via direct DOM (bypass Playwright isVisible quirk)
  const calResult = await page.evaluate(()=>{
    const today = new Date().toISOString().split('T')[0];
    // Must use window.fn() explicitly in Playwright evaluate context
    const hasFn = typeof window.openFloatPanel==='function' && typeof window.renderNewCalEventPanel==='function';
    if(hasFn) {
      try {
        window.openFloatPanel('Nouveau RDV — '+today, window.renderNewCalEventPanel(today));
        if(typeof window.setupNewCalEventPanel==='function') window.setupNewCalEventPanel(today);
      } catch(err) { return 'err:'+err.message; }
    } else {
      return 'fn-missing:'+Object.keys(window).filter(k=>k.includes('Float')||k.includes('Cal')).join(',');
    }
    const w = document.getElementById('fp-float-panel');
    return { hidden: w ? w.hasAttribute('hidden') : 'no-wrapper', hasFn };
  });
  log(`  Cal result: ${JSON.stringify(calResult)}`);
  await page.waitForTimeout(400);
  const open = await page.evaluate(()=>{
    const w = document.getElementById('fp-float-panel');
    return w && !w.hasAttribute('hidden');
  });
  RESULTS.push(open ? pass('Calendar — add event panel opens') : fail('Calendar — add event btn missing'));
  if(open) {
    await page.evaluate(()=>{
      const inp=document.querySelector('#fp-float-panel input[type="text"],#fp-float-panel input');
      if(inp){inp.value='Événement Test';inp.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    await page.waitForTimeout(300);
    const sub = await page.evaluate(()=>{
      const b=Array.from(document.querySelectorAll('#fp-float-panel button'))
        .find(b=>b.textContent.includes('Créer')||b.textContent.includes('Ajouter')||b.textContent.includes('Sauvegarder'));
      if(b){b.click();return b.textContent.trim();} return null;
    });
    log(`  Calendar event submit: ${sub}`);
    await page.waitForTimeout(1500);
    await closePanels(page);
  }

  // Views: month, week, list
  for (const view of ['month','week','list','day']) {
    await page.evaluate(v=>{
      const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&b.textContent.toLowerCase().includes(v));
      if(b) b.click();
    }, view);
    await page.waitForTimeout(600);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`Calendar/${view} view — no NaN`) : fail(`Calendar/${view} view — NaN`, n.join(',')));
  }
  await shot(page, 'calendar-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditAI(page) {
  log('\n══════════════ AI ASSISTANT ══════════════');
  await navSPA(page, 'ai');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('AI — 0 NaN') : fail('AI — NaN', nans.join(',')));

  const len = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(len>50 ? pass('AI — page loaded') : fail('AI — page empty'));

  // Send a message
  const sent = await page.evaluate(()=>{
    const inp = document.querySelector('#ai-chat-input,#fp-ai-input,textarea[placeholder*="message"],textarea[placeholder*="Question"]');
    if(inp) {
      inp.value='Quelles sont mes priorités SEO ?';
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      const btn = document.querySelector('#ai-send-btn,#fp-ai-send,button[type="submit"]');
      if(btn){btn.click();return true;}
    }
    return false;
  });
  log(`  AI message sent: ${sent}`);
  if(sent) await page.waitForTimeout(2000);

  for (const sub of ['chat','insights','recommendations','automation']) {
    await navSPA(page, 'ai', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`AI/${sub} — no NaN`) : fail(`AI/${sub} — NaN`, n.join(',')));
  }
  await shot(page, 'ai-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditCRM(page) {
  log('\n══════════════ CRM ══════════════');
  await navSPA(page, 'crm');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('CRM — 0 NaN') : fail('CRM — NaN', nans.join(',')));

  const len = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(len>50 ? pass('CRM — page loaded') : fail('CRM — empty'));

  for (const sub of ['contacts','leads','deals','pipeline']) {
    await navSPA(page, 'crm', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`CRM/${sub} — no NaN`) : fail(`CRM/${sub} — NaN`, n.join(',')));
  }

  // Add contact
  await navSPA(page, 'crm', null, 800);
  const addBtn = await page.evaluate(()=>{
    const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&
      (b.textContent.includes('Ajouter')||b.textContent.includes('Nouveau contact')||b.textContent.includes('+')));
    if(b){b.click();return b.textContent.trim();} return null;
  });
  log(`  CRM add btn: ${addBtn}`);
  await page.waitForTimeout(800);
  const panel = await panelVisible(page);
  RESULTS.push(addBtn ? pass('CRM — add btn clickable') : fail('CRM — no add btn'));
  await closePanels(page);
  await shot(page, 'crm-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditMarketIntel(page) {
  log('\n══════════════ MARKET INTELLIGENCE ══════════════');
  await navSPA(page, 'market-intelligence');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('MarketIntel — 0 NaN') : fail('MarketIntel — NaN', nans.join(',')));

  const len = await page.evaluate(()=>document.body.innerText.length);
  RESULTS.push(len>50 ? pass('MarketIntel — page loaded') : fail('MarketIntel — empty'));

  for (const sub of ['overview','trends','opportunities','industry']) {
    await navSPA(page, 'market-intelligence', sub, 1000);
    const n = await checkNaN(page);
    RESULTS.push(n.length===0 ? pass(`MarketIntel/${sub} — no NaN`) : fail(`MarketIntel/${sub} — NaN`, n.join(',')));
  }
  await shot(page, 'market-intel-main');
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function auditTeam(page) {
  log('\n══════════════ TEAM ══════════════');
  await navSPA(page, 'team');

  const nans = await checkNaN(page);
  RESULTS.push(nans.length===0 ? pass('Team — 0 NaN') : fail('Team — NaN', nans.join(',')));

  // Invite member
  const inviteBtn = await page.evaluate(()=>{
    const b=Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&
      (b.textContent.includes('Inviter')||b.textContent.includes('Ajouter membre')||b.textContent.includes('+ Membre')));
    if(b){b.click();return b.textContent.trim();} return null;
  });
  log(`  Team invite btn: ${inviteBtn}`);
  await page.waitForTimeout(800);
  const panel = await panelVisible(page);
  RESULTS.push(inviteBtn ? pass('Team — invite btn clickable') : fail('Team — no invite btn'));
  await closePanels(page);
  await shot(page, 'team-main');
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

  await auditConversion(page);
  await auditForecast(page);
  await auditCalendar(page);
  await auditAI(page);
  await auditCRM(page);
  await auditMarketIntel(page);
  await auditTeam(page);

  // Extra pages
  for (const [route, label] of [
    ['live','Live Analytics'],
    ['activity','Activity Feed'],
    ['data-explorer','Data Explorer'],
  ]) {
    await auditPage(page, route, label);
  }

  await ctx.close();
  await browser.close();

  const total = RESULTS.length, passed = RESULTS.filter(r=>r.ok).length, failed = total-passed;
  console.log('\n' + '═'.repeat(60));
  console.log(`  BATCH D+E AUDIT: ${passed}/${total} passed  |  ${failed} failed`);
  console.log('═'.repeat(60));
  RESULTS.filter(r=>!r.ok).forEach(r => console.log(`  ❌  ${r.name}: ${r.detail}`));
  if(consoleErrs.length) {
    console.log('\nJS Errors:');
    [...new Set(consoleErrs)].slice(0,15).forEach(e=>console.log('  ⚠️ ',e));
  }
  writeFileSync(`${DIR}/p04-results.json`, JSON.stringify(RESULTS, null, 2));
  console.log(`\nScreenshots → ${DIR}/`);
  process.exit(failed>0 ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e.message?.substring(0,300)); process.exit(1); });
