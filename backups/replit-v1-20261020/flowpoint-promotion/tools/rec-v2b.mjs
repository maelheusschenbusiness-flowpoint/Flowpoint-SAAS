/**
 * V2b — Audits SEO → résultat → mission → monitoring → Core Web Vitals
 * Fix: navigate via hash + wait STATE.route pour éviter l'overview au départ
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v2b'; mkdirSync(TMP, { recursive: true });
const DEST = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';

const r = await fetch(BASE + '/api/admin/test-session', {
  method: 'POST',
  headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
});
const { token } = await r.json();
if (!token) throw new Error('No token');

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p) {
  await p.evaluate(s => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div'); w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s; document.body.appendChild(w);
    let cx = 640, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left = cx + 'px'; w.style.top = cy + 'px'; }, { passive: true });
    window._cx = cx; window._cy = cy;
  }, CSR);
}
async function go(p, tx, ty, ms = 450) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(16, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) { const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e)); await p.waitForTimeout(14); }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}
async function navTo(p, route) {
  await p.evaluate(s => { if (window.navigate) window.navigate(s); else window.location.hash = s; }, route);
  await p.waitForFunction(r => window.STATE?.route === r, route, { timeout: 8000, polling: 200 }).catch(() => {});
  await p.waitForTimeout(600);
}
async function cl(p, s, ams = 600, mms = 380) {
  try {
    const el = p.locator(s).first();
    if (!await el.isVisible({ timeout: 4000 }).catch(() => false)) return false;
    const b = await el.boundingBox();
    if (!b || b.x < 150) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms);
    await p.waitForTimeout(70); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(ams); await inj(p); return true;
  } catch { return false; }
}
async function fi(p, s, t) {
  try {
    const el = p.locator(s).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox();
    if (!b) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 280);
    await el.click(); await p.waitForTimeout(140); await el.fill(t); await p.waitForTimeout(180);
    return true;
  } catch { return false; }
}
async function hov(p, s, max = 3, d = 300) {
  const it = p.locator(s); const n = Math.min(await it.count(), max);
  for (let i = 0; i < n; i++) { const b = await it.nth(i).boundingBox().catch(() => null); if (b && b.x > 150) { await go(p, b.x + b.width / 2, b.y + b.height / 2, 320); await p.waitForTimeout(d); } }
}
async function sc(p, d, ms = 400) {
  const n = Math.max(5, Math.round(ms / 30)); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); } await p.waitForTimeout(80);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: TMP, size: { width: 1280, height: 720 } },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
// Set session AND pre-set the route so audits loads first
await ctx.addInitScript(tok => {
  try { sessionStorage.setItem('fp_session_token', tok); } catch {}
  // Force initial route to audits so dashboard renders audits on first load
  try { sessionStorage.setItem('fp_last_route', 'audits'); } catch {}
}, token);
const page = await ctx.newPage();
const t0 = Date.now();

// Load with hash to hint the route
await page.goto(BASE + '/dashboard.html#audits', { waitUntil: 'domcontentloaded', timeout: 30000 });
try {
  await page.waitForFunction(
    () => typeof window.STATE !== 'undefined' && window.STATE.loading === false && (window.STATE.audits || []).length > 0,
    { timeout: 28000, polling: 300 }
  );
} catch { await page.waitForTimeout(4000); }

// Navigate to audits and confirm the route is active
await navTo(page, 'audits');
await page.waitForFunction(() => document.querySelectorAll('tr[data-audit-id]').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
await page.waitForTimeout(700);

// Dismiss any modals
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click(); await page.waitForTimeout(300); } } catch {}
}
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// === AUDITS PAGE ===
// 1. Hover audit row to show score 93
await hov(page, 'tr[data-audit-id]', 1, 600);

// 2. Open audit detail panel via JS
await page.evaluate(() => {
  const audit = (window.STATE?.audits || [])[0];
  if (audit && window.openFloatPanel && window.renderAuditDetailPanel) {
    window.openFloatPanel("Détail de l'audit", window.renderAuditDetailPanel(audit));
    if (window.bindAuditPanelBtns) window.bindAuditPanelBtns(audit);
  }
});
await page.waitForTimeout(1400);
await inj(page);

// 3. Scroll audit detail — score, catégories, problèmes, recommandation
const panel = page.locator('.fp-float-panel').first();
const pb = await panel.boundingBox().catch(() => null);
if (pb) {
  await go(page, pb.x + pb.width / 2, pb.y + 100, 280);
  await page.waitForTimeout(500);
  await go(page, pb.x + pb.width * 0.7, pb.y + 150, 250);
  await page.waitForTimeout(400);
  await sc(page, 140, 450);
  await page.waitForTimeout(600);
  // Hover "Fix IA" or "Créer mission" button
  await go(page, pb.x + pb.width * 0.5, pb.y + 220, 280);
  await page.waitForTimeout(400);
  await sc(page, 100, 350);
  await page.waitForTimeout(400);
}

// 4. Click "Créer mission" from panel (or "+ Fix IA")
const missionBtn = await cl(page, 'button:has-text("Créer mission"),button:has-text("Fix IA"),button:has-text("Créer une mission"),a:has-text("Créer mission")', 700, 300);
if (!missionBtn) {
  // Close panel and navigate to missions manually
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}
await page.waitForTimeout(300);

// === MISSIONS — create from audit ===
// If not already on missions from the button click, navigate
const route = await page.evaluate(() => window.STATE?.route || '');
if (!route.includes('mission')) {
  await navTo(page, 'missions');
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr,.fp-mission-row').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
}
await inj(page);

// 5. Create a new mission from the audit finding
await cl(page, 'button:has-text("+ Mission"),button:has-text("Mission"),#mission-quick-add-btn', 500, 330);
await fi(page, 'input[placeholder*="Titre"],input[placeholder*="Nom"]', 'Corriger les balises title manquantes');
await page.waitForTimeout(220);
await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1000, 280);
await page.waitForTimeout(350);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(350);

// 6. Show mission list with new mission
await hov(page, 'table tbody tr,.fp-mission-row', 2, 300);
await inj(page);

// === MONITORING — create monitor ===
await navTo(page, 'monitors');
await page.waitForFunction(() => document.querySelectorAll('.fp-monitor-card,.fp-monitor-row').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
await inj(page);

// 7. Show monitors (5 DOWN)
await hov(page, '.fp-monitor-card,.fp-monitor-row', 3, 300);

// 8. Create new monitor
await cl(page, 'button:has-text("+ Nouveau"),button:has-text("Nouveau monitor")', 500, 330);
await fi(page, 'input[placeholder*="URL"],input[type="url"],input[name="url"]', 'https://example.com/services');
await page.waitForTimeout(250);
await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1100, 280);
await page.waitForTimeout(350);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(400);

// 9. Show monitor list with new entry
await hov(page, '.fp-monitor-card,.fp-monitor-row', 2, 280);
await inj(page);

// === CORE WEB VITALS ===
await navTo(page, 'core-web-vitals');
await page.waitForTimeout(1200);
await inj(page);

// 10. Show CWV page content (shows "Aucune donnée CWV" + button)
await go(page, 640, 280, 280);
await page.waitForTimeout(500);
await go(page, 500, 380, 250);
await page.waitForTimeout(400);
// Hover the "Analyser un site" button
const cwvBtn = page.locator('button:has-text("Analyser un site"),button:has-text("Performance"),.fp-btn').first();
const cwvBox = await cwvBtn.boundingBox().catch(() => null);
if (cwvBox && cwvBox.x > 150) {
  await go(page, cwvBox.x + cwvBox.width / 2, cwvBox.y + cwvBox.height / 2, 280);
  await page.waitForTimeout(700);
}
await go(page, 640, 360, 250);
await page.waitForTimeout(600);

await page.close(); await ctx.close(); await browser.close();

const files = readdirSync(TMP).filter(f => f.endsWith('.webm'));
const mp4 = join(TMP, 'step2.mp4');
const ss = Math.max(0, (skip - 400) / 1000);
const args = ['-y'];
if (ss > 0.5) args.push('-ss', ss.toFixed(2));
args.push('-i', join(TMP, files[0]),
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
spawnSync('ffmpeg', args, { stdio: 'pipe' });
spawnSync('cp', [mp4, join(DEST, 'step2-audit-actions.mp4')]);

const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString().trim();
console.log(`✓ step2-audit-actions.mp4  ${parseFloat(dur).toFixed(1)}s`);

mkdirSync('/tmp/frm2b', { recursive: true });
for (const t of [1, 4, 8, 13, 18, 24, 30, 36, 40]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm2b/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
