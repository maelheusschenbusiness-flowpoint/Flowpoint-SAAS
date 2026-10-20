/**
 * Targeted verification: #fp-float-panel and #fp-heatmap-modal
 * Confirms the "create" buttons DO open panels — our earlier checks used wrong selectors.
 */
import pkg from '/home/runner/workspace/node_modules/playwright/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';

const BASE_URL = 'http://localhost:8081';
const SCREENSHOT_DIR = '/tmp/fp-audit-screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const TOKEN = process.env.TOKEN_F;
function log(msg) { console.log(`[${new Date().toISOString().substring(11,19)}] ${msg}`); }

async function shot(page, name) {
  try { await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` }); log(`  📸 ${name}`); } catch(_) {}
}

async function floatPanelOpen(page) {
  return page.locator('#fp-float-panel:not([hidden])').isVisible({ timeout: 2000 }).catch(() => false);
}

async function heatmapModalOpen(page) {
  return page.locator('#fp-heatmap-modal').evaluate(el => el.style.display !== 'none').catch(() => false);
}

async function navSPA(page, route) {
  await page.evaluate(r => { if (typeof navigate === 'function') navigate(r); }, route);
  await page.waitForTimeout(2500);
}

async function main() {
  log('🔍 Float-panel targeted verification');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Auth
  await page.goto(`${BASE_URL}/login-verify.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/dashboard/, { timeout: 10000 }).catch(() => {});
  log(`  Auth → ${page.url()}`);

  const tests = [
    {
      name: 'Reports — create button → float panel',
      route: 'reports',
      click: 'button:has-text("Générer"), button:has-text("Créer"), button:has-text("Nouveau rapport")',
      check: 'floatPanel',
    },
    {
      name: 'Local SEO — add button → float panel',
      route: 'local-seo',
      click: 'button:has-text("Ajouter"), button:has-text("Configurer")',
      check: 'floatPanel',
    },
    {
      name: 'Competitors — add button → float panel',
      route: 'competitor',
      click: 'button:has-text("Ajouter"), button:has-text("+ Concurrent")',
      check: 'floatPanel',
    },
    {
      name: 'Keywords — add button → float panel',
      route: 'keywords',
      click: 'button:has-text("Ajouter"), button:has-text("Tracker")',
      check: 'floatPanel',
    },
    {
      name: 'Calendar — create event → float panel',
      route: 'calendar',
      click: '.fp-cal-add-btn, .fp-cal-agenda-add-rdv, button:has-text("Créer")',
      check: 'floatPanel',
    },
    {
      name: 'GBP Posts — inline form (no separate modal expected)',
      route: 'gbp-posts',
      click: null,
      check: 'inline',
    },
    {
      name: 'Local Maps — create heatmap → #fp-heatmap-modal',
      route: 'local-maps',
      click: 'button:has-text("Nouvelle heatmap"), button:has-text("Créer ma première heatmap"), button:has-text("+ Nouvelle")',
      check: 'heatmap',
    },
  ];

  const results = [];

  for (const t of tests) {
    log(`\n--- ${t.name} ---`);
    await navSPA(page, t.route);
    await shot(page, `verify-${t.route}-initial`);

    if (t.check === 'inline') {
      // GBP Posts: verify the inline textarea exists (no modal)
      const textarea = await page.locator('textarea').first().isVisible({ timeout: 2000 }).catch(() => false);
      const result = { name: t.name, ok: textarea, details: textarea ? 'Inline form/textarea present' : 'No textarea found' };
      log(`  ${result.ok ? '✅' : '❌'} ${result.details}`);
      results.push(result);
      continue;
    }

    // Click the button
    let clicked = false;
    try {
      const el = page.locator(t.click).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        clicked = true;
        log(`  ✅ Clicked button`);
      } else {
        log(`  ⚪ Button not found: ${t.click}`);
      }
    } catch(e) {
      log(`  ⚠️  Click error: ${e.message.substring(0,100)}`);
    }

    // Check the correct panel/modal opened
    let panelOpen = false;
    let panelDetails = '';

    if (t.check === 'floatPanel') {
      panelOpen = await floatPanelOpen(page);
      if (panelOpen) {
        const title = await page.locator('#fp-float-panel-title').textContent().catch(() => '?');
        panelDetails = `Float panel opened: "${title}"`;
      } else {
        // Check if it might be in a different state
        const hasPanel = await page.locator('#fp-float-panel').count();
        panelDetails = hasPanel > 0 ? 'Panel element exists but hidden' : 'Panel element not found';
      }
    } else if (t.check === 'heatmap') {
      panelOpen = await heatmapModalOpen(page);
      if (!panelOpen) {
        // Try the float panel as fallback
        panelOpen = await floatPanelOpen(page);
        panelDetails = panelOpen ? 'Float panel opened instead' : 'Neither heatmap modal nor float panel visible';
      } else {
        panelDetails = '#fp-heatmap-modal opened';
      }
    }

    await shot(page, `verify-${t.route}-after-click`);

    const result = {
      name: t.name,
      ok: clicked && panelOpen,
      details: !clicked ? 'Button not found' : panelOpen ? panelDetails : panelDetails,
    };
    log(`  ${result.ok ? '✅' : '❌'} ${result.details}`);
    results.push(result);

    // Close panel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  await ctx.close();
  await browser.close();

  // Summary
  console.log('\n' + '═'.repeat(65));
  console.log('  FLOAT PANEL / MODAL VERIFICATION RESULTS');
  console.log('═'.repeat(65));
  let ok = 0, fail = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    if (r.ok) ok++; else fail++;
    console.log(`  ${icon}  ${r.name}`);
    console.log(`       → ${r.details}`);
  }
  console.log(`\n  ${ok}/${ok+fail} verified  |  ${fail} failures`);
  console.log('═'.repeat(65) + '\n');
}

main().catch(e => { console.error('FATAL:', e.message?.substring(0,300)); process.exit(1); });
