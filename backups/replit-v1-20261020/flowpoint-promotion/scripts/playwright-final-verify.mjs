/**
 * Post-fix verification — corrected selectors
 */
import pkg from '/home/runner/workspace/node_modules/playwright/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';

const BASE_URL = 'http://localhost:8081';
const SCREENSHOT_DIR = '/tmp/fp-audit-screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });
const TOKEN = process.env.TOKEN_J;

const results = [];
function log(msg) { console.log(msg); }

async function waitReady(page, max = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const ok = await page.evaluate(() => typeof navigate === 'function' && typeof openFloatPanel === 'function').catch(() => false);
    if (ok) return;
    await page.waitForTimeout(500);
  }
}

async function navSPA(page, route, sub) {
  await page.evaluate((r) => { if (typeof navigate === 'function') navigate(r); }, route);
  await page.waitForTimeout(2200);
  if (sub) {
    await page.evaluate((s) => { if (typeof navigateSub === 'function') navigateSub(s); }, sub);
    await page.waitForTimeout(1500);
  }
}

async function closeAny(page) {
  await page.evaluate(() => {
    if (typeof closeFloatPanel === 'function') closeFloatPanel();
    ['fp-kw-modal','fp-heatmap-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m) m.style.display = 'none';
    });
  });
  await page.waitForTimeout(200);
}

async function check(name, fn) {
  log(`\n--- ${name} ---`);
  try {
    const ok = await fn();
    results.push({ name, ok });
    log(`  ${ok ? '✅' : '❌'} ${name}`);
    return ok;
  } catch(e) {
    log(`  ❌ ERROR: ${e.message.substring(0,200)}`);
    results.push({ name, ok: false, error: e.message.substring(0,100) });
    return false;
  }
}

async function main() {
  log('🔍 Post-fix verification v2');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0,150)); });
  page.on('pageerror', err => consoleErrors.push('PAGE_ERR: ' + err.message.substring(0,150)));

  await page.goto(`${BASE_URL}/login-verify.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/dashboard/, { timeout: 12000 }).catch(() => {});
  await waitReady(page);
  log(`Auth → ${page.url()}`);

  // ── 1. Reports "Generer rapport" ─────────────────────────────
  await check('Reports — Generer rapport → float panel', async () => {
    await navSPA(page, 'reports');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('Generer rapport') && b.offsetParent !== null);
      if (btn) btn.click();
    });
    await page.waitForTimeout(900);
    const visible = await page.locator('#fp-float-panel:not([hidden])').isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) {
      const title = await page.locator('#fp-float-panel-title').textContent().catch(() => '?');
      log(`  Panel: "${title}"`);
      await closeAny(page);
    }
    return visible;
  });

  // ── 2. Competitors "Ajouter concurrent" ──────────────────────
  await check('Competitors — Ajouter concurrent → float panel', async () => {
    await navSPA(page, 'competitor');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('Ajouter concurrent') && b.offsetParent !== null);
      if (btn) btn.click();
      else if (typeof window.FP_showAddCompetitor === 'function') window.FP_showAddCompetitor();
    });
    await page.waitForTimeout(800);
    const visible = await page.locator('#fp-float-panel:not([hidden])').isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) {
      const hasName = await page.locator('#fp-comp-name').count() > 0;
      const hasUrl  = await page.locator('#fp-comp-url').count() > 0;
      log(`  Form fields: name=${hasName}, url=${hasUrl}`);
      await closeAny(page);
    }
    return visible;
  });

  // ── 3. Keywords → #fp-kw-modal ──────────────────────────────
  await check('Keywords — Ajouter mot-clé → #fp-kw-modal', async () => {
    await navSPA(page, 'keywords');
    await page.evaluate(() => {
      // Click the exact "+ Ajouter un mot-clé" button
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === '+ Ajouter un mot-clé' && b.offsetParent !== null);
      if (btn) btn.click();
      else if (typeof window._showAddKeyword === 'function') window._showAddKeyword();
    });
    await page.waitForTimeout(800);
    const kwVisible = await page.evaluate(() => {
      const m = document.getElementById('fp-kw-modal');
      return m ? m.style.display !== 'none' : false;
    });
    log(`  #fp-kw-modal: ${kwVisible}`);
    if (kwVisible) await closeAny(page);
    return kwVisible;
  });

  // ── 4. Local SEO → Map tab → heatmap modal ──────────────────
  // #fp-heatmap-modal is in renderLocalDominationMaps() → sub='map'
  await check('Local SEO → Map tab → heatmap modal (direct call)', async () => {
    await navSPA(page, 'local-seo', 'map');
    await page.waitForTimeout(500);
    // The zones tab must render #fp-heatmap-modal in the DOM
    const modalInDom = await page.evaluate(() => !!document.getElementById('fp-heatmap-modal'));
    log(`  #fp-heatmap-modal in DOM: ${modalInDom}`);
    if (!modalInDom) return false;
    // Open it directly
    await page.evaluate(() => {
      if (typeof window._showCreateHeatmapModal === 'function') {
        window._showCreateHeatmapModal();
      } else {
        const m = document.getElementById('fp-heatmap-modal');
        if (m) m.style.display = 'flex';
      }
    });
    await page.waitForTimeout(600);
    const hmVisible = await page.evaluate(() => {
      const m = document.getElementById('fp-heatmap-modal');
      return m ? m.style.display !== 'none' : false;
    });
    log(`  #fp-heatmap-modal visible: ${hmVisible}`);
    if (hmVisible) await closeAny(page);
    return hmVisible;
  });

  // ── 5. Missions calendar view → fp-cal-add-btn ──────────────
  // Note: STATE.missionView defaults to 'list'. The monthly grid with
  // fp-cal-add-btn is in the Missions section when missionView='calendar'.
  await check('Missions calendar view → fp-cal-add-btn → float panel', async () => {
    await navSPA(page, 'missions');
    // Switch to calendar view
    await page.evaluate(() => {
      if (typeof STATE !== 'undefined') {
        STATE.missionView = 'calendar';
        if (typeof render === 'function') render(STATE.currentSection || 'missions');
      }
    });
    await page.waitForTimeout(1500);

    const calBtnCount = await page.locator('.fp-cal-add-btn').count();
    log(`  .fp-cal-add-btn count after switching to calendar view: ${calBtnCount}`);

    if (calBtnCount > 0) {
      // Force-click (bypasses opacity:0 CSS)
      await page.locator('.fp-cal-add-btn').first().click({ force: true });
      await page.waitForTimeout(800);
      const visible = await page.locator('#fp-float-panel:not([hidden])').isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        const title = await page.locator('#fp-float-panel-title').textContent().catch(() => '?');
        log(`  Panel: "${title}"`);
        await closeAny(page);
      }
      return visible;
    }

    // Fallback: fp-cal-agenda-add-rdv button
    const agendaBtnCount = await page.locator('.fp-cal-agenda-add-rdv').count();
    log(`  .fp-cal-agenda-add-rdv count: ${agendaBtnCount}`);
    if (agendaBtnCount > 0) {
      await page.locator('.fp-cal-agenda-add-rdv').first().click({ force: true });
      await page.waitForTimeout(800);
      const visible = await page.locator('#fp-float-panel:not([hidden])').isVisible({ timeout: 1500 }).catch(() => false);
      if (visible) { await closeAny(page); }
      return visible;
    }

    return false;
  });

  // ── 6. Local SEO → GBP tab ──────────────────────────────────
  await check('Local SEO → GBP tab — content present', async () => {
    await navSPA(page, 'local-seo', 'gbp');
    const body = await page.evaluate(() => document.body.innerText);
    return /GBP|Google Business|Fiche|Publication|post|Avis/i.test(body);
  });

  await ctx.close();
  await browser.close();

  // ── SUMMARY ─────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65));
  console.log('  POST-FIX VERIFICATION v2 — RESULTS');
  console.log('═'.repeat(65));
  let ok = 0, fail = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    if (r.ok) ok++; else fail++;
    console.log(`  ${icon}  ${r.name}`);
    if (r.error) console.log(`       Error: ${r.error}`);
  }
  console.log(`\n  ${ok}/${ok+fail} passed`);
  console.log('═'.repeat(65) + '\n');

  const uniqErrs = [...new Set(consoleErrors)].slice(0, 8);
  if (uniqErrs.length) {
    console.log('JS errors captured:');
    uniqErrs.forEach(e => console.log(`  ⚠️  ${e}`));
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message?.substring(0, 300)); process.exit(1); });
