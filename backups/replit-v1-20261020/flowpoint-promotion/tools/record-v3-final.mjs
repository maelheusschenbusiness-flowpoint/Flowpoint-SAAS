/**
 * FlowPoint Onboarding Videos — full re-record v3
 * Rule: NEVER click list rows (they navigate to overview for QA account).
 *       Only use modal-open buttons, hover rows, navigate via window.navigate().
 *
 * Videos: step2, step3, step4, step5, step6
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = 'https://app.flowpoint.pro';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_DIR  = '/tmp/fp-v3';
const DEST_DIR = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
mkdirSync(OUT_DIR, { recursive: true });

// ─── helpers ──────────────────────────────────────────────────────────────────
async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error(JSON.stringify(d));
  return d.token;
}

async function seed() {
  const r = await fetch(`${BASE}/api/admin/demo-seed`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, clear: true }),
  });
  return r.json();
}

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function injectCursor(page) {
  await page.evaluate(svg => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div');
    w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = svg;
    document.body.appendChild(w);
    let cx = 640, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left = cx+'px'; w.style.top = cy+'px'; }, { passive: true });
    document.addEventListener('mousedown', () => {
      w.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,.5)) brightness(.85)';
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${cx-8}px;top:${cy-8}px;width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(59,130,246,.65);pointer-events:none;z-index:2147483646;animation:_cr .35s ease-out forwards`;
      document.body.appendChild(r); setTimeout(() => r.remove(), 380);
    });
    document.addEventListener('mouseup', () => { w.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,.5))'; });
    if (!document.getElementById('_crs')) {
      const s = document.createElement('style'); s.id = '_crs';
      s.textContent = '@keyframes _cr{0%{transform:scale(.3);opacity:1}100%{transform:scale(2);opacity:0}}';
      document.head.appendChild(s);
    }
    window._cx = cx; window._cy = cy;
  }, CURSOR_SVG);
}

async function go(page, tx, ty, ms = 480) {
  const { x, y } = await page.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(18, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < .5 ? 2*t*t : -1+(4-2*t)*t;
    await page.mouse.move(Math.round(x+(tx-x)*e), Math.round(y+(ty-y)*e));
    await page.waitForTimeout(14);
  }
  await page.evaluate((p) => { window._cx = p.x; window._cy = p.y; }, { x: tx, y: ty });
}

async function scroll(page, delta, ms = 600) {
  const n = Math.max(8, Math.round(ms / 30));
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, delta / n); await page.waitForTimeout(30); }
  await page.waitForTimeout(100);
}

// Click a selector IF visible — return false if not found, never throw
async function $click(page, sel, afterMs = 600, moveMs = 420) {
  try {
    const el = page.locator(sel).first();
    if (!await el.isVisible({ timeout: 3500 }).catch(() => false)) return false;
    const b = await el.boundingBox(); if (!b) return false;
    await go(page, b.x + b.width/2, b.y + b.height/2, moveMs);
    await page.waitForTimeout(80);
    await page.mouse.click(b.x + b.width/2, b.y + b.height/2);
    await page.waitForTimeout(afterMs);
    await injectCursor(page);
    return true;
  } catch { return false; }
}

// Type into a field
async function $type(page, sel, text, delay = 58) {
  try {
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox(); if (!b) return false;
    await go(page, b.x + b.width/2, b.y + b.height/2, 350);
    await page.mouse.click(b.x + b.width/2, b.y + b.height/2);
    await page.waitForTimeout(160);
    await page.keyboard.type(text, { delay });
    return true;
  } catch { return false; }
}

// Navigate via window.navigate — never via sidebar label (causes redirect traps)
async function nav(page, route) {
  await page.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash = r; }, route);
  await page.waitForTimeout(1800);
  await injectCursor(page);
}

// Hover n items in a locator without clicking
async function hoverItems(page, sel, max = 3, dwellMs = 320) {
  const items = page.locator(sel);
  const n = Math.min(await items.count(), max);
  for (let i = 0; i < n; i++) {
    const b = await items.nth(i).boundingBox().catch(() => null);
    if (b && b.width > 40 && b.height > 10) {
      await go(page, b.x + b.width/2, b.y + b.height/2, 380);
      await page.waitForTimeout(dwellMs);
    }
  }
}

// Boot dashboard + wait for STATE.loading=false + dismiss onboarding
async function boot(page, token, gotoRoute = 'overview') {
  const t0 = Date.now();
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 25000, polling: 300 });
  } catch {
    await page.waitForSelector('h1,h2,.fp-kpi-card', { timeout: 12000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);
  // Dismiss onboarding modal
  for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")', 'button:has-text("Skip")', '[aria-label*="close"]']) {
    try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 600 }).catch(() => false)) { await b.click(); await page.waitForTimeout(400); break; } } catch {}
  }
  // Navigate to target route BEFORE trim
  await nav(page, gotoRoute);
  // For monitors/missions: wait for rows to appear before measuring skip
  if (gotoRoute === 'monitors') {
    await page.waitForSelector('table tbody tr,.monitor-card', { timeout: 8000 }).catch(() => {});
    // Extra wait to ensure data is rendered
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('table tbody tr,.monitor-card');
      return rows.length > 0;
    }, { timeout: 6000, polling: 400 }).catch(() => {});
  }
  await page.waitForTimeout(1200);
  await page.mouse.move(650, 350);
  await page.evaluate(() => { window._cx = 650; window._cy = 350; });
  await injectCursor(page);
  return Date.now() - t0;
}

function toMp4(webm, mp4, skipMs = 0) {
  const ss = Math.max(0, (skipMs - 400) / 1000);
  const args = ['-y'];
  if (ss > 0.5) args.push('-ss', ss.toFixed(2));
  args.push('-i', webm, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
  const r = spawnSync('ffmpeg', args, { stdio: 'pipe' });
  if (r.status !== 0) console.error('ffmpeg error:', r.stderr?.toString()?.slice(-300));
}

async function record(name, scenarioFn, token, startRoute = 'overview') {
  const tmp = join(OUT_DIR, `t_${name}`);
  mkdirSync(tmp, { recursive: true });

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: tmp, size: { width: 1280, height: 720 } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(tok => {
    try { sessionStorage.setItem('fp_session_token', tok); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, token);

  const page = await ctx.newPage();
  let skipMs = 0;
  try {
    skipMs = await scenarioFn(page, token, startRoute);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }

  const files = readdirSync(tmp).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm: ' + name);
  const mp4 = join(OUT_DIR, `${name}.mp4`);
  toMp4(join(tmp, files[0]), mp4, skipMs);
  spawnSync('cp', [mp4, join(DEST_DIR, `${name}.mp4`)]);
  const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString().trim();
  console.log(`✓ ${name}.mp4  ${parseFloat(dur).toFixed(1)}s  (trimmed ${(skipMs/1000).toFixed(1)}s)`);
  return { name, mp4, duration: parseFloat(dur), skipMs };
}

// ══════════════════════════════════════════════════════════════════════════════
// V I D E O   2  —  Audits → Missions → Monitors → Core Web Vitals
// ══════════════════════════════════════════════════════════════════════════════
async function v2(page, token, startRoute) {
  const skip = await boot(page, token, 'audits');

  // ── Audits SEO ────────────────────────────────────────────────────────────
  await page.waitForSelector('.fp-audit-table,table tbody,#fp-audit-list', { timeout: 8000 }).catch(() => {});
  // Hover stat blocks
  for (const [x, y] of [[245,170],[490,170],[720,170],[1000,170]]) { await go(page,x,y,320); await page.waitForTimeout(260); }
  // Hover rows
  await hoverItems(page, 'table tbody tr,.audit-row,.fp-audit-row', 3, 300);
  // Scroll down to see filter bar
  await scroll(page, 80, 400);
  await go(page, 640, 380, 320); await page.waitForTimeout(350);
  await scroll(page, -80, 350);
  // Click "+ Nouvel audit" (opens modal, not row click)
  await $click(page, 'button:has-text("Nouvel audit"),button:has-text("+ Nouvel audit"),#fp-new-audit-btn', 500, 400);
  // Type a QA URL in the audit URL input
  const auditUrlTyped = await $type(page, 'input[placeholder*="https"],input[id*="audit-url"],input[placeholder*="URL"]', 'https://boulangerie-artisanale.fr', 55);
  if (auditUrlTyped) {
    await page.waitForTimeout(350);
    // Click Lancer
    await $click(page, 'button:has-text("Lancer"),button:has-text("Analyser"),button[type="submit"]', 800, 350);
  } else {
    // Use the inline URL field
    await $type(page, 'input[placeholder*="monsite.fr"],.fp-audit-url-input', 'https://boulangerie-artisanale.fr', 55);
    await page.waitForTimeout(300);
    await $click(page, 'button:has-text("Lancer"),button:has-text("+ Lancer")', 800, 350);
  }
  await page.waitForTimeout(600);
  await go(page, 640, 380, 350); await page.waitForTimeout(500);
  // Dismiss any modal
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500); await injectCursor(page);

  // ── Missions ───────────────────────────────────────────────────────────────
  await nav(page, 'missions');
  await page.waitForSelector('table tbody tr,.mission-item', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  // Hover mission rows (NO click)
  await hoverItems(page, 'table tbody tr,.mission-item,.mission-row', 3, 310);
  // Hover stat blocks
  for (const [x, y] of [[220,165],[420,165],[620,165],[820,165]]) { await go(page,x,y,300); await page.waitForTimeout(250); }
  // Create a mission via + button
  await $click(page, '#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Créer une mission"),button:has-text("+ Ajouter")', 600, 380);
  // Fill mission title field
  const missionFilled = await $type(page, 'input[id*="mission"],input[placeholder*="Titre"],input[placeholder*="mission"],input[placeholder*="Nom"]', 'Optimiser les fiches GBP', 58);
  if (!missionFilled) {
    await $type(page, 'input[placeholder*="Optimis"],textarea[placeholder*="mission"],.mission-title-input', 'Optimiser les fiches GBP', 58);
  }
  await page.waitForTimeout(280);
  // Submit
  await $click(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"],#nm2-create', 1200, 320);
  await go(page, 640, 380, 350); await page.waitForTimeout(500);
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); await injectCursor(page);

  // ── Monitors ──────────────────────────────────────────────────────────────
  await nav(page, 'monitors');
  await page.waitForSelector('table tbody tr,.monitor-card', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  await hoverItems(page, 'table tbody tr,.monitor-card,.monitor-row', 3, 300);
  for (const [x, y] of [[220,165],[420,165],[620,165],[820,165]]) { await go(page,x,y,300); await page.waitForTimeout(240); }
  // Create monitor via "+ Nouveau" button
  await $click(page, '#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau monitor")', 700, 380);
  await $type(page, 'input[id*="url"],input[placeholder*="https://"],input[type="url"]', 'https://boulangerie-artisanale.fr', 60);
  await page.waitForTimeout(280);
  await $click(page, '#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]', 1200, 320);
  await go(page, 640, 380, 350); await page.waitForTimeout(500);
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); await injectCursor(page);

  // ── Core Web Vitals ───────────────────────────────────────────────────────
  await nav(page, 'performance-web');
  await page.waitForSelector('h1,h2,.fp-psi-section', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  for (const [x, y] of [[350,200],[640,200],[900,200]]) { await go(page,x,y,320); await page.waitForTimeout(250); }
  await scroll(page, 60, 350); await go(page, 640, 350, 300); await page.waitForTimeout(350); await scroll(page, -60, 300);
  // Type QA URL in PSI URL field
  const psiTyped = await $type(page, '#fp-psi-url-input,input[placeholder*="Entrez une URL"],input[placeholder*="URL du site"],input[id*="psi"]', 'https://boulangerie-artisanale.fr', 58);
  if (psiTyped) {
    await page.waitForTimeout(300);
    await $click(page, 'button:has-text("Analyser"),button:has-text("Lancer l\'analyse"),button[type="submit"]', 1000, 320);
  }
  await go(page, 640, 380, 350); await page.waitForTimeout(600);

  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// V I D E O   3  —  Monitors : tabs + data + create + Alertes
// ══════════════════════════════════════════════════════════════════════════════
async function v3(page, token, startRoute) {
  const skip = await boot(page, token, 'monitors');

  // Confirm monitors are visible (3 monitors from seed)
  const rowCount = await page.locator('table tbody tr,.monitor-card').count();
  console.log(`  [v3] monitor rows visible: ${rowCount}`);

  // ── Hover stat blocks ─────────────────────────────────────────────────────
  for (const [x, y] of [[210,165],[400,165],[600,165],[800,165],[1000,165]]) {
    await go(page, x, y, 330); await page.waitForTimeout(270);
  }

  // ── Hover monitor rows (left column, middle, right) ───────────────────────
  await hoverItems(page, 'table tbody tr,.monitor-card,.monitor-row', 3, 400);

  // ── Click tabs: Performance, Incidents, Config, SLA ──────────────────────
  for (const label of ['Performance', 'Incidents', 'Config', 'SLA']) {
    const tab = page.locator(`[role="tab"]:has-text("${label}"),button:has-text("${label}"):visible,.tab-bar a:has-text("${label}")`).first();
    if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) {
      const b = await tab.boundingBox().catch(() => null);
      if (b) {
        await go(page, b.x + b.width/2, b.y + b.height/2, 370);
        await page.mouse.click(b.x + b.width/2, b.y + b.height/2);
        await page.waitForTimeout(700); await injectCursor(page);
        await go(page, 640, 360, 300); await page.waitForTimeout(350);
        await scroll(page, 50, 300); await page.waitForTimeout(250); await scroll(page, -50, 280);
      }
    }
  }
  // Back to Status
  await $click(page, '[role="tab"]:has-text("Status"),button:has-text("Status")', 600, 340);

  // ── Hover rows one more time after tab return ─────────────────────────────
  await hoverItems(page, 'table tbody tr,.monitor-card', 3, 300);

  // ── Create a new monitor ──────────────────────────────────────────────────
  await $click(page, '#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")', 700, 380);
  await $type(page, 'input[id*="url"],input[placeholder*="https"],input[type="url"]', 'https://restaurant-chez-pierre.fr', 60);
  await page.waitForTimeout(280);
  await $click(page, '#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]', 1300, 320);
  await go(page, 640, 380, 350); await page.waitForTimeout(500);
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); await injectCursor(page);

  // ── Navigate to Alertes ───────────────────────────────────────────────────
  await nav(page, 'alerts-center');
  await page.waitForSelector('h1,h2,.alert-command-center', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  // Hover stat blocks
  for (const [x, y] of [[210,195],[420,195],[630,195],[840,195]]) { await go(page,x,y,330); await page.waitForTimeout(260); }
  // Hover alert tabs
  for (const label of ['Incidents', 'SEO', 'Performance']) {
    await $click(page, `[role="tab"]:has-text("${label}"),button:has-text("${label}")`, 600, 340);
  }
  // Click "+ Nouvelle règle" button (opens modal)
  await $click(page, 'button:has-text("Nouvelle règle"),button:has-text("+ Nouvelle règle")', 800, 380);
  await go(page, 640, 360, 350); await page.waitForTimeout(600);
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); await injectCursor(page);

  // Hover threat intelligence section below
  await scroll(page, 200, 600); await go(page, 640, 440, 350); await page.waitForTimeout(500);
  await scroll(page, -200, 500); await page.waitForTimeout(400);

  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// V I D E O   4  —  Local SEO tabs + Concurrents (hover only)
// ══════════════════════════════════════════════════════════════════════════════
async function v4(page, token, startRoute) {
  const skip = await boot(page, token, 'local-seo');
  await page.waitForSelector('h1,h2', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);

  // ── Hover stat blocks ─────────────────────────────────────────────────────
  for (const [x, y] of [[210,195],[440,195],[660,195],[880,195]]) { await go(page,x,y,320); await page.waitForTimeout(260); }

  // ── Click Local SEO tabs (Carte, Zones, Opportunités, Avis IA, GBP) ──────
  for (const label of ['Carte', 'Zones', 'Opportunités', 'Avis IA', 'GBP']) {
    const tab = page.locator(`[role="tab"]:has-text("${label}"),button:has-text("${label}"):visible,.fp-tab:has-text("${label}")`).first();
    if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
      const b = await tab.boundingBox().catch(() => null);
      if (b) {
        await go(page, b.x+b.width/2, b.y+b.height/2, 370);
        await page.mouse.click(b.x+b.width/2, b.y+b.height/2);
        await page.waitForTimeout(800); await injectCursor(page);
        await go(page, 640, 360, 300); await page.waitForTimeout(380);
        await scroll(page, 60, 350); await page.waitForTimeout(280); await scroll(page, -60, 300);
      }
    }
  }
  // Back to Aperçu
  await $click(page, '[role="tab"]:has-text("Aperçu"),button:has-text("Aperçu")', 700, 340);
  await go(page, 640, 360, 320); await page.waitForTimeout(400);
  await scroll(page, 80, 400); await go(page, 640, 420, 300); await page.waitForTimeout(400); await scroll(page, -80, 350);

  // ── Navigate to Concurrents ───────────────────────────────────────────────
  // Use the Concurrents TAB within Local SEO (not the sidebar)
  const concTab = page.locator('[role="tab"]:has-text("Concurrents"),button:has-text("Concurrents"):visible').first();
  if (await concTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await $click(page, '[role="tab"]:has-text("Concurrents"),button:has-text("Concurrents")', 1200, 380);
  } else {
    // Sidebar Concurrents
    await nav(page, 'concurrents');
  }
  await page.waitForSelector('h1,h2,.competitor-card,.competitor-row,table tbody tr', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  // Hover competitor items (NO click — row click → overview)
  await hoverItems(page, 'table tbody tr,.competitor-card,.competitor-row', 3, 380);
  for (const [x, y] of [[280,200],[540,200],[780,200],[1020,200]]) { await go(page,x,y,320); await page.waitForTimeout(270); }
  await scroll(page, 100, 500); await go(page, 640, 400, 320); await page.waitForTimeout(450); await scroll(page, -100, 450);
  await page.waitForTimeout(400);

  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// V I D E O   5  —  Assistant IA + Rapports
// ══════════════════════════════════════════════════════════════════════════════
async function v5(page, token, startRoute) {
  const skip = await boot(page, token, 'ai');
  await page.waitForSelector('#ai-input,input[id*="ai-input"],[placeholder*="question"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  // ── AI assistant interface ─────────────────────────────────────────────────
  // Hover quick-suggestion buttons
  await hoverItems(page, '.fp-suggestion-btn,.quick-suggestion,[class*="suggestion"] button', 4, 280);
  // Type question
  await go(page, 640, 540, 380); await page.waitForTimeout(250);
  await $click(page, '#ai-input,input[id*="ai-input"],textarea[id*="ai"]', 400, 350);
  await page.keyboard.type('Quelles sont mes priorités SEO cette semaine ?', { delay: 52 });
  await page.waitForTimeout(450);
  // Send
  await $click(page, '#ai-send,button[aria-label*="Envoyer"],button:has-text("Envoyer"),.fp-send-btn', 500, 300);
  // Wait for response to appear (up to 15s)
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.fp-ai-bubble,.ai-msg,.assistant-msg,[data-role="assistant"],[class*="assistant"]');
    return msgs.length > 0 && [...msgs].some(m => m.textContent.trim().length > 30);
  }, { timeout: 18000, polling: 500 }).catch(() => {});
  await page.waitForTimeout(600); await injectCursor(page);
  // Scan response
  await go(page, 640, 340, 380); await page.waitForTimeout(500);
  await scroll(page, 120, 500); await go(page, 640, 420, 320); await page.waitForTimeout(500);
  await scroll(page, 100, 450); await go(page, 640, 460, 300); await page.waitForTimeout(400);
  await scroll(page, -220, 600); await page.waitForTimeout(400);

  // ── Rapports ──────────────────────────────────────────────────────────────
  await nav(page, 'reports');
  await page.waitForSelector('h1,h2,.report-card,.fp-report-card', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  // Hover top controls
  for (const [x, y] of [[800,100],[950,100],[1100,100]]) { await go(page,x,y,320); await page.waitForTimeout(250); }
  // Hover report cards (NO click)
  await hoverItems(page, '.report-card,.fp-report-card,[data-report]', 4, 350);
  await scroll(page, 80, 400); await go(page, 640, 420, 320); await page.waitForTimeout(400); await scroll(page, -80, 350);
  // Click "+ Créer un rapport" or "Nouveau"
  await $click(page, 'button:has-text("Créer un rapport"),button:has-text("Nouveau rapport"),button:has-text("Nouveau")', 1200, 380);
  await go(page, 640, 360, 350); await page.waitForTimeout(800);
  // If a modal/form opened, interact with it
  await $click(page, 'button:has-text("Générer"),button:has-text("Générer rapport"),button:has-text("Créer")', 1200, 350);
  await go(page, 640, 380, 350); await page.waitForTimeout(600);
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); await injectCursor(page);
  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// V I D E O   6  —  Quotidien : Missions + Activité + Notifs + Messages + Overview
// ══════════════════════════════════════════════════════════════════════════════
async function v6(page, token, startRoute) {
  const skip = await boot(page, token, 'missions');
  await page.waitForSelector('table tbody tr,.mission-item', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);

  // ── Missions : hover rows + stat blocks ──────────────────────────────────
  for (const [x, y] of [[220,160],[430,160],[630,160],[830,160]]) { await go(page,x,y,320); await page.waitForTimeout(260); }
  await hoverItems(page, 'table tbody tr,.mission-item,.mission-row', 3, 380);

  // ── Create a mission (modal, not row click) ───────────────────────────────
  await $click(page, '#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Créer une mission")', 600, 380);
  await $type(page, 'input[placeholder*="Titre"],input[id*="mission"],input[placeholder*="Nom de la mission"]', 'Améliorer la page Contact', 57);
  await page.waitForTimeout(280);
  await $click(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"],#nm2-create', 1200, 320);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500); await injectCursor(page);

  // ── Activité panel ────────────────────────────────────────────────────────
  if (await $click(page, '#fp-activity-btn,[aria-label*="ctivité"],button:has-text("Activité")', 1000, 400)) {
    await go(page, 1060, 250, 350); await page.waitForTimeout(350);
    await go(page, 1060, 330, 300); await page.waitForTimeout(320);
    await go(page, 1060, 410, 300); await page.waitForTimeout(350);
    await scroll(page, 60, 350); await page.waitForTimeout(300); await scroll(page, -60, 300);
    await page.mouse.click(350, 400); await page.waitForTimeout(400); await injectCursor(page);
  }

  // ── Notifications panel ───────────────────────────────────────────────────
  if (await $click(page, '#fp-notif-btn,[aria-label*="otif"],button:has-text("Notifications")', 900, 400)) {
    await go(page, 1000, 240, 350); await page.waitForTimeout(300);
    await hoverItems(page, '#fp-notif-dropdown .fp-notif-item,[id*="notif"] li,.notification-item', 3, 300);
    await page.mouse.click(400, 450); await page.waitForTimeout(400); await injectCursor(page);
  }

  // ── Messages panel ────────────────────────────────────────────────────────
  if (await $click(page, '#fp-msg-btn,[aria-label*="essage"],button:has-text("Messages")', 900, 400)) {
    // Click first channel
    await $click(page, '#fp-msg-dropdown .fp-msg-channel-btn,[id*="msg"] .channel-btn', 500, 320);
    // Type a message
    const typed = await $type(page, '#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]', 'Rapport SEO semaine 37 envoyé ✓', 55);
    if (typed) {
      await page.waitForTimeout(280);
      await $click(page, '#fp-msg-send,button[aria-label*="Envoyer"],button:has-text("Envoyer")', 500, 280);
    }
    await page.mouse.click(400, 400); await page.waitForTimeout(400); await injectCursor(page);
  }

  // ── Back to Overview ──────────────────────────────────────────────────────
  await nav(page, 'overview');
  await page.waitForSelector('.fp-kpi-card,.kpi-card,h1', { timeout: 6000 }).catch(() => {});
  // Hover KPI cards
  await hoverItems(page, '.fp-kpi-card,.kpi-card,[data-kpi],.metric-card', 4, 330);
  if (await page.locator('.fp-kpi-card').count() === 0) {
    for (const [x, y] of [[280,200],[520,200],[760,200],[1000,200]]) { await go(page,x,y,330); await page.waitForTimeout(280); }
  }
  await scroll(page, 100, 500); await go(page, 640, 400, 320); await page.waitForTimeout(600); await scroll(page, -100, 450);
  await page.waitForTimeout(600);
  return skip;
}

// ═══════════════════════════════════════════════════════════════════════════
// M A I N
// ═══════════════════════════════════════════════════════════════════════════
console.log('▶ Seeding demo data…');
const seedRes = await seed();
console.log('  seed:', JSON.stringify(seedRes));

const token = await getToken();
console.log('  token ok\n');

const scenarios = [
  { name: 'step2-audit-actions',    fn: v2 },
  { name: 'step3-monitoring-alerts',fn: v3 },
  { name: 'step4-local-competition',fn: v4 },
  { name: 'step5-ai-reports',       fn: v5 },
  { name: 'step6-daily',            fn: v6 },
];

const results = [];
for (const { name, fn } of scenarios) {
  console.log(`\n▶ ${name}`);
  try {
    const r = await record(name, fn, token);
    results.push(r);
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    results.push({ name, error: e.message });
  }
}

console.log('\n── Summary ──');
for (const r of results) {
  if (r.error) console.log(`  ❌ ${r.name}: ${r.error}`);
  else console.log(`  ✓  ${r.name}: ${r.duration.toFixed(1)}s`);
}

// Final file sizes
spawnSync('ls', ['-lh', ...results.filter(r=>!r.error).map(r=>join(DEST_DIR, r.name+'.mp4'))], { stdio: 'inherit' });
