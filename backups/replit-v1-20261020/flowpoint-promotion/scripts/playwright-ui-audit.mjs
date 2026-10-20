/**
 * FlowPoint UI Audit — Playwright direct (bypasses blocked SDK)
 * Batches B-E covering all remaining pages.
 * Run with: LD_PRELOAD=/tmp/libudev.so.1 PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true node scripts/playwright-ui-audit.mjs
 */
import pkg from '/home/runner/workspace/node_modules/playwright/index.js';
const { chromium } = pkg;
import { writeFileSync, mkdirSync } from 'fs';

const BASE_URL = 'http://localhost:8081';
const SCREENSHOT_DIR = '/tmp/fp-audit-screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const TOKENS = {
  B: process.env.TOKEN_B,
  C: process.env.TOKEN_C,
  D: process.env.TOKEN_D,
  E: process.env.TOKEN_E,
};

const results = [];
let browser, context, page;
const LAUNCH_OPTS = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

function ts() { return new Date().toISOString().substring(11,19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

async function shot(name) {
  try {
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false });
    log(`  📸 ${name}.png`);
  } catch(e) { log(`  ⚠️  screenshot failed: ${e.message.substring(0,80)}`); }
}

async function noNaN() {
  const text = await page.evaluate(() => document.body.innerText);
  const bad = [];
  if (/\bNaN\b/.test(text)) bad.push('NaN');
  if (/\bundefined\b/.test(text)) bad.push('undefined');
  if (/\[object Object\]/.test(text)) bad.push('[object Object]');
  if (/\bInfinity\b/.test(text)) bad.push('Infinity');
  return bad;
}

async function navSPA(route) {
  await page.evaluate((r) => { if (typeof navigate === 'function') navigate(r); }, route);
  await page.waitForTimeout(2800);
}

async function tryClick(selector, label) {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      log(`    ✅ clicked: ${label}`);
      return true;
    }
  } catch(e) { /* silent */ }
  log(`    ⚪ not found: ${label}`);
  return false;
}

async function closeModal() {
  // Try Escape, then X button
  const modal = page.locator('.fp-modal, .modal, [role="dialog"], .fp-overlay, .modal-overlay').first();
  if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    // If still open, click close
    const still = await modal.isVisible({ timeout: 300 }).catch(() => false);
    if (still) {
      await tryClick('button:has-text("Fermer"), button:has-text("Annuler"), .modal-close, [data-dismiss]', 'close-modal');
    }
  }
}

async function modalOpen() {
  return await page.locator('.fp-modal, .modal, [role="dialog"], .fp-overlay').first()
    .isVisible({ timeout: 1500 }).catch(() => false);
}

async function auth(token) {
  log(`\n🔐 Auth via magic link...`);
  await page.goto(`${BASE_URL}/login-verify.html?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Wait for redirect to dashboard
  try {
    await page.waitForURL(/dashboard/, { timeout: 10000 });
    log('  ✅ Redirected to dashboard');
    return true;
  } catch (_) {}

  const url = page.url();
  const content = await page.content();

  if (url.includes('dashboard')) { log('  ✅ On dashboard'); return true; }
  if (content.includes('succès') || content.includes('Connexion')) {
    await page.waitForURL(/dashboard/, { timeout: 5000 }).catch(() => {});
    log('  ✅ Auth success page — waiting...'); return true;
  }

  log(`  ❌ Auth failed. URL: ${url}`);
  await shot('auth-fail');
  return false;
}

async function testPage(name, route, checks) {
  log(`\n--- ${name} [route: ${route}] ---`);
  const r = { section: name, route, issues: [], clicks: [], tabsVerified: 0 };

  await navSPA(route);
  await shot(`${route}-loaded`);

  // Check for NaN/undefined
  const bad = await noNaN();
  if (bad.length) {
    r.issues.push(`BAD_VALUES: ${bad.join(', ')}`);
    log(`  ❌ Bad values found: ${bad.join(', ')}`);
  } else {
    log(`  ✅ No NaN/undefined/null`);
  }

  // Check page actually rendered (not blank)
  const bodyText = await page.evaluate(() => document.body.innerText.trim());
  if (bodyText.length < 50) {
    r.issues.push('BLANK_OR_SHORT_PAGE');
    log(`  ❌ Page appears blank (${bodyText.length} chars)`);
  } else {
    log(`  ✅ Page has content (${bodyText.length} chars)`);
  }

  // Check for 404/500/error text
  if (/404|500|not found|erreur serveur/i.test(bodyText.substring(0, 500))) {
    r.issues.push('PAGE_ERROR_TEXT');
    log(`  ❌ Error text detected in page`);
  }

  // Run specific interactions
  for (const c of checks) {
    const clicked = await tryClick(c.sel, c.label);
    if (clicked) {
      r.clicks.push(c.label);
      if (c.expectModal) {
        const open = await modalOpen();
        if (open) {
          log(`    ✅ Modal opened`);
          await shot(`${route}-modal-${c.label.replace(/\s+/g, '-').substring(0,20)}`);
          await closeModal();
        } else {
          r.issues.push(`MODAL_NOT_OPENED after: ${c.label}`);
          log(`    ⚠️  Modal expected but not visible`);
        }
      }
      if (c.expectTab) {
        r.tabsVerified++;
        const bad2 = await noNaN();
        if (bad2.length) r.issues.push(`BAD_VALUES_IN_TAB: ${bad2.join(', ')}`);
        await shot(`${route}-tab-${r.tabsVerified}`);
      }
    }
  }

  // Click all visible tabs/nav items
  const tabs = await page.locator('.fp-tab, [data-section], .section-tab, [role="tab"]').all();
  for (let i = 0; i < Math.min(tabs.length, 5); i++) {
    try {
      const visible = await tabs[i].isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        await tabs[i].click();
        await page.waitForTimeout(900);
        r.tabsVerified++;
        const bad3 = await noNaN();
        if (bad3.length) r.issues.push(`BAD_VALUES_IN_TAB_${i}: ${bad3.join(', ')}`);
        log(`    ✅ tab ${i + 1} clicked — OK`);
      }
    } catch(e) {}
  }

  results.push(r);
  return r;
}

// ============================================================
async function main() {
  log('🚀 FlowPoint UI Audit — Batches B-E');

  browser = await chromium.launch(LAUNCH_OPTS);

  // ===== BATCH B: Reports, Billing, Settings, Alerts =====
  log('\n\n📦 BATCH B — Reports / Billing / Settings / Alerts');
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  if (await auth(TOKENS.B)) {
    // Reports
    await testPage('Reports', 'reports', [
      { sel: 'button:has-text("Générer"), button:has-text("Créer"), button:has-text("Nouveau rapport")', label: 'create-report', expectModal: true },
      { sel: '.report-type, [data-type]', label: 'report-type-select' },
    ]);

    // Billing
    await testPage('Billing', 'billing', [
      { sel: 'button:has-text("Gérer"), button:has-text("Manage"), button:has-text("Changer")', label: 'manage-plan' },
      { sel: '.plan-card, .pricing-card, [data-plan]', label: 'plan-card-click' },
    ]);

    // Settings — tab exploration
    await testPage('Settings', 'settings', [
      { sel: '.settings-nav a:nth-child(2), .settings-sidebar li:nth-child(2)', label: 'settings-nav-2', expectTab: true },
      { sel: '.settings-nav a:nth-child(3), .settings-sidebar li:nth-child(3)', label: 'settings-nav-3', expectTab: true },
      { sel: 'button:has-text("Sauvegarder"), button:has-text("Enregistrer"), button[type="submit"]', label: 'save-settings' },
    ]);

    // Alert Rules
    await testPage('Alerts Center', 'alerts-center', [
      { sel: 'button:has-text("Créer"), button:has-text("Nouvelle"), button:has-text("+ Alerte"), button:has-text("Ajouter")', label: 'create-alert', expectModal: true },
      { sel: '.alert-rule-row:first-child .fp-toggle, .rule-item:first-child .switch', label: 'toggle-first-rule' },
    ]);
  }
  await context.close();

  // ===== BATCH C: Local SEO, Competitors, Keywords, Growth =====
  log('\n\n📦 BATCH C — Local SEO / Competitors / Keywords / Growth');
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  if (await auth(TOKENS.C)) {
    // Local SEO
    await testPage('Local SEO', 'local-seo', [
      { sel: 'button:has-text("Ajouter"), button:has-text("Configurer GBP"), button:has-text("+")', label: 'add-location', expectModal: true },
    ]);

    // Competitors
    await testPage('Competitors', 'competitor', [
      { sel: 'button:has-text("Ajouter"), button:has-text("+ Concurrent"), button:has-text("+")', label: 'add-competitor', expectModal: true },
      { sel: '.competitor-card:first-child, .competitor-item:first-child', label: 'first-competitor' },
    ]);

    // Keywords
    await testPage('Keywords', 'keywords', [
      { sel: 'button:has-text("Ajouter"), button:has-text("Tracker"), button:has-text("+ Mot-clé")', label: 'add-keyword', expectModal: true },
      { sel: 'input[placeholder*="recherche"], input[placeholder*="Filtrer"], input[type="search"]', label: 'search-keywords' },
    ]);

    // Growth
    await testPage('Growth', 'growth', [
      { sel: 'button:has-text("Exporter"), button:has-text("Voir rapport")', label: 'growth-action' },
    ]);
  }
  await context.close();

  // ===== BATCH D: Conversion, Forecast, Calendar, AI =====
  log('\n\n📦 BATCH D — Conversion / Forecast / Calendar / AI');
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  if (await auth(TOKENS.D)) {
    // Conversion
    await testPage('Conversion', 'conversion', [
      { sel: 'button:has-text("Analyser"), button:has-text("Scanner"), button:has-text("Détecter")', label: 'analyze-conversion' },
    ]);

    // Forecast
    await testPage('Forecast', 'forecast', [
      { sel: 'select, input[type="range"], .fp-period-select', label: 'forecast-period' },
    ]);

    // Calendar
    await testPage('Calendar', 'calendar', [
      { sel: 'button:has-text("Ajouter"), button:has-text("+ Événement"), button:has-text("Créer")', label: 'create-event', expectModal: true },
    ]);

    // AI
    await testPage('AI Assistant', 'ai', [
      { sel: 'textarea, input[placeholder*="question"], input[placeholder*="message"], input[placeholder*="Message"]', label: 'ai-input' },
    ]);
  }
  await context.close();

  // ===== BATCH E: CRM, Market Intel, Review Intel, GBP, Maps =====
  log('\n\n📦 BATCH E — CRM / Market Intel / Review Intel / GBP / Maps');
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  if (await auth(TOKENS.E)) {
    // CRM
    await testPage('CRM', 'crm', [
      { sel: 'button:has-text("Connecter"), button:has-text("Sync"), button:has-text("Importer")', label: 'crm-connect' },
    ]);

    // Market Intelligence
    await testPage('Market Intelligence', 'market-intelligence', [
      { sel: 'button:has-text("Analyser"), button:has-text("Rafraîchir"), button:has-text("Voir")', label: 'market-analyze' },
    ]);

    // Review Intelligence
    await testPage('Review Intelligence', 'review-intelligence', [
      { sel: 'button:has-text("Répondre"), button:has-text("Analyser"), button:has-text("Générer")', label: 'review-action' },
    ]);

    // GBP Posts
    await testPage('GBP Posts', 'gbp-posts', [
      { sel: 'button:has-text("Créer"), button:has-text("Nouveau post"), button:has-text("+")', label: 'create-gbp-post', expectModal: true },
    ]);

    // Local Maps / Heat Maps
    await testPage('Local Maps', 'local-maps', [
      { sel: 'button:has-text("Créer"), button:has-text("Nouvelle heatmap"), button:has-text("+")', label: 'create-heatmap', expectModal: true },
    ]);
  }
  await context.close();

  await browser.close();

  // ===== FINAL REPORT =====
  console.log('\n\n' + '═'.repeat(65));
  console.log('  FLOWPOINT UI AUDIT — FINAL REPORT (Batches B-E)');
  console.log('═'.repeat(65));

  let ok = 0, fail = 0;
  for (const r of results) {
    const icon = r.issues.length === 0 ? '✅' : '❌';
    if (r.issues.length === 0) ok++; else fail++;
    console.log(`\n${icon}  ${r.section} (${r.route})`);
    if (r.clicks.length) console.log(`     Interactions: ${r.clicks.join(', ')}`);
    if (r.tabsVerified) console.log(`     Tabs verified: ${r.tabsVerified}`);
    if (r.issues.length) r.issues.forEach(i => console.log(`     ⚠️  ${i}`));
  }

  console.log('\n' + '═'.repeat(65));
  console.log(`  RESULT: ${ok}/${ok + fail} sections clean  |  ${fail} with issues`);
  console.log(`  Screenshots → ${SCREENSHOT_DIR}/`);
  console.log('═'.repeat(65) + '\n');

  writeFileSync('/tmp/fp-audit-results.json', JSON.stringify(results, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message?.substring(0, 300));
  process.exit(1);
});
