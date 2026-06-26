/**
 * FlowPoint — Batch E remaining: Market Intel, Review Intel, GBP Posts, Local Maps
 */
import pkg from '/home/runner/workspace/node_modules/playwright/index.js';
const { chromium } = pkg;
import { writeFileSync, mkdirSync } from 'fs';

const BASE_URL = 'http://localhost:8081';
const SCREENSHOT_DIR = '/tmp/fp-audit-screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const TOKEN_E2 = process.env.TOKEN_E2;
const results = [];

function log(msg) { console.log(`[${new Date().toISOString().substring(11,19)}] ${msg}`); }

async function shot(page, name) {
  try { await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` }); log(`  📸 ${name}`); } catch(_) {}
}

async function noNaN(page) {
  const t = await page.evaluate(() => document.body.innerText);
  const bad = [];
  if (/\bNaN\b/.test(t)) bad.push('NaN');
  if (/\bundefined\b/.test(t)) bad.push('undefined');
  if (/\[object Object\]/.test(t)) bad.push('[object Object]');
  return bad;
}

async function navSPA(page, route) {
  await page.evaluate((r) => { if (typeof navigate === 'function') navigate(r); }, route);
  await page.waitForTimeout(3000);
}

async function tryClick(page, sel, label) {
  try {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      log(`    ✅ clicked: ${label}`);
      return true;
    }
  } catch(_) {}
  log(`    ⚪ not found: ${label}`);
  return false;
}

async function modalOpen(page) {
  return page.locator('.fp-modal, .modal, [role="dialog"], .fp-overlay').first()
    .isVisible({ timeout: 1500 }).catch(() => false);
}

async function closeModal(page) {
  if (await modalOpen(page)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

async function testPage(page, name, route, checks) {
  log(`\n--- ${name} [${route}] ---`);
  const r = { section: name, route, issues: [], clicks: [], tabs: 0 };

  await navSPA(page, route);
  await shot(page, `${route}-loaded`);

  const bad = await noNaN(page);
  if (bad.length) { r.issues.push(`BAD_VALUES: ${bad.join(',')}`); log(`  ❌ ${bad.join(',')}`); }
  else log(`  ✅ No NaN/undefined/null`);

  const bodyLen = (await page.evaluate(() => document.body.innerText.trim())).length;
  if (bodyLen < 50) { r.issues.push('BLANK_PAGE'); log(`  ❌ Blank page`); }
  else log(`  ✅ Has content (${bodyLen} chars)`);

  for (const c of checks) {
    const clicked = await tryClick(page, c.sel, c.label);
    if (clicked) {
      r.clicks.push(c.label);
      if (c.expectModal) {
        const open = await modalOpen(page);
        if (open) { log(`    ✅ Modal opened`); await shot(page, `${route}-modal`); await closeModal(page); }
        else { r.issues.push(`MODAL_NOT_OPENED:${c.label}`); log(`    ⚠️  Modal not visible`); }
      }
    }
  }

  // Click visible tabs
  const tabs = await page.locator('[role="tab"], .fp-tab, [data-section]').all();
  for (let i = 0; i < Math.min(tabs.length, 5); i++) {
    try {
      if (await tabs[i].isVisible({ timeout: 400 }).catch(() => false)) {
        await tabs[i].click();
        await page.waitForTimeout(900);
        r.tabs++;
        const b2 = await noNaN(page);
        if (b2.length) r.issues.push(`BAD_IN_TAB_${i}:${b2.join(',')}`);
        log(`    ✅ tab ${i+1}`);
      }
    } catch(_) {}
  }

  results.push(r);
}

async function main() {
  log('🚀 Batch E remaining: Market Intel / Review Intel / GBP / Maps');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Auth
  log('\n🔐 Auth...');
  await page.goto(`${BASE_URL}/login-verify.html?token=${TOKEN_E2}`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForURL(/dashboard/, { timeout: 10000 }); log('  ✅ Auth OK'); }
  catch(_) { log(`  ⚠️  Auth state: ${page.url()}`); }

  await testPage(page, 'Market Intelligence', 'market-intelligence', [
    { sel: 'button:has-text("Analyser"), button:has-text("Rafraîchir")', label: 'market-analyze' },
    { sel: 'button:has-text("Exporter"), button:has-text("Voir")', label: 'market-export' },
  ]);

  await testPage(page, 'Review Intelligence', 'review-intelligence', [
    { sel: 'button:has-text("Répondre"), button:has-text("Analyser"), button:has-text("Générer")', label: 'review-action' },
    { sel: '.review-filter, select[name="filter"]', label: 'review-filter' },
  ]);

  await testPage(page, 'GBP Posts', 'gbp-posts', [
    { sel: 'button:has-text("Créer"), button:has-text("Nouveau post"), button:has-text("+ Post"), button:has-text("+")', label: 'create-post', expectModal: true },
  ]);

  await testPage(page, 'Local Maps', 'local-maps', [
    { sel: 'button:has-text("Créer"), button:has-text("Nouvelle"), button:has-text("+ Heatmap"), button:has-text("+")', label: 'create-heatmap', expectModal: true },
  ]);

  await context.close();
  await browser.close();

  // Report
  console.log('\n' + '═'.repeat(60));
  console.log('  BATCH E REMAINING — RESULTS');
  console.log('═'.repeat(60));
  let ok = 0, fail = 0;
  for (const r of results) {
    const icon = r.issues.length === 0 ? '✅' : '❌';
    if (r.issues.length === 0) ok++; else fail++;
    console.log(`\n${icon}  ${r.section}`);
    if (r.clicks.length) console.log(`     Clicked: ${r.clicks.join(', ')}`);
    if (r.tabs) console.log(`     Tabs: ${r.tabs}`);
    r.issues.forEach(i => console.log(`     ⚠️  ${i}`));
  }
  console.log(`\n  ${ok}/${ok+fail} clean  |  ${fail} with issues`);
  console.log('═'.repeat(60));

  // Load previous results and merge
  let allResults = [];
  try { allResults = JSON.parse(require('fs').readFileSync('/tmp/fp-audit-results.json')); } catch(_) {}
  allResults.push(...results);
  writeFileSync('/tmp/fp-audit-all-results.json', JSON.stringify(allResults, null, 2));
}

main().catch(e => { console.error('FATAL:', e.message?.substring(0,300)); process.exit(1); });
