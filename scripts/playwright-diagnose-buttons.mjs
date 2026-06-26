/**
 * Diagnose: list ALL buttons on each failing section page
 */
import pkg from '/home/runner/workspace/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE_URL = 'http://localhost:8081';
const TOKEN = process.env.TOKEN_G;

function log(msg) { console.log(msg); }

async function navSPA(page, route) {
  await page.evaluate(r => { if (typeof navigate === 'function') navigate(r); }, route);
  await page.waitForTimeout(2500);
}

async function listButtons(page, route) {
  await navSPA(page, route);
  const buttons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map(b => ({
      text: b.textContent.trim().substring(0, 60),
      id: b.id || '',
      cls: b.className.substring(0, 80),
      onclick: (b.getAttribute('onclick') || '').substring(0, 120),
      visible: b.offsetParent !== null,
    })).filter(b => b.text.length > 0 && b.visible);
  });
  log(`\n=== ${route.toUpperCase()} — ${buttons.length} visible buttons ===`);
  buttons.forEach((b, i) => {
    log(`  [${i}] "${b.text}" | id="${b.id}" | onclick="${b.onclick.substring(0,80)}"`);
  });

  // Also check for float panel state
  const panelState = await page.evaluate(() => {
    const p = document.getElementById('fp-float-panel');
    return p ? (p.hasAttribute('hidden') ? 'hidden' : 'VISIBLE') : 'NOT_FOUND';
  });
  log(`  #fp-float-panel: ${panelState}`);
}

async function main() {
  log('🔍 Button diagnostics for failing sections');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/login-verify.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/dashboard/, { timeout: 10000 }).catch(() => {});
  log(`Auth → ${page.url()}`);

  for (const route of ['reports', 'local-seo', 'competitor', 'keywords', 'calendar', 'gbp-posts', 'local-maps']) {
    await listButtons(page, route);
  }

  await ctx.close();
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message?.substring(0,300)); process.exit(1); });
