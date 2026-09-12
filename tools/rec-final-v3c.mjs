/**
 * V3c — Monitoring détail + Incidents + Alertes
 * Fix: attendre STATE.monitors.length > 0 AVANT navigate (Phase 3 = async)
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-fv3c'; mkdirSync(TMP, { recursive: true });
const DEST = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';

const r = await fetch(BASE + '/api/admin/test-session', {
  method: 'POST', headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
});
const { token } = await r.json(); if (!token) throw new Error('No token');

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p) {
  await p.evaluate(s => {
    document.getElementById('_fpa')?.remove(); const w = document.createElement('div'); w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s; document.body.appendChild(w); let cx = 640, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left = cx + 'px'; w.style.top = cy + 'px'; }, { passive: true });
    window._cx = cx; window._cy = cy;
  }, CSR);
}
async function go(p, tx, ty, ms = 390) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(14, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) { const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e)); await p.waitForTimeout(14); }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}
async function sidebarNav(p, route) {
  await p.evaluate(r => { if (window.navigate) window.navigate(r); }, route);
  await p.waitForFunction(r => window.STATE?.route === r, route, { timeout: 8000, polling: 200 }).catch(() => {});
  await p.waitForTimeout(600);
}
async function cl(p, s, ams = 450, mms = 300) {
  try {
    const el = p.locator(s).first(); if (!await el.isVisible({ timeout: 4000 }).catch(() => false)) return false;
    const b = await el.boundingBox(); if (!b || b.x < 150) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms); await p.waitForTimeout(70);
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(ams); await inj(p); return true;
  } catch { return false; }
}
async function hov(p, s, max = 4, d = 260) {
  const it = p.locator(s); const n = Math.min(await it.count(), max);
  for (let i = 0; i < n; i++) { const b = await it.nth(i).boundingBox().catch(() => null); if (b && b.x > 150) { await go(p, b.x + b.width / 2, b.y + b.height / 2, 270); await p.waitForTimeout(d); } }
}
async function sc(p, d, ms = 360) {
  const n = Math.max(5, Math.round(ms / 30)); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); } await p.waitForTimeout(80);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 }, recordVideo: { dir: TMP, size: { width: 1280, height: 720 } },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
await ctx.addInitScript(tok => {
  try { sessionStorage.setItem('fp_session_token', tok); } catch {}
}, token);
const page = await ctx.newPage();
const t0 = Date.now();

// Load overview first — let Phase 1+2 settle
await page.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
try { await page.waitForFunction(() => window.STATE?.loading === false, { timeout: 25000, polling: 300 }); } catch { await page.waitForTimeout(3000); }
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click(); await page.waitForTimeout(250); } } catch {}
}

// Wait for Phase 3 monitors data to arrive
await page.waitForFunction(
  () => (window.STATE?.monitors || []).length > 0,
  { timeout: 12000, polling: 300 }
).catch(() => {});
console.log('monitors loaded:', await page.evaluate(() => (window.STATE?.monitors || []).length));

// Navigate to monitors AFTER data is ready
await sidebarNav(page, 'monitors');
await page.waitForFunction(() => document.querySelectorAll('.fp-monitor-card,.fp-monitor-row').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
await page.waitForTimeout(500);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// === 1. Monitors list — show KPI bar + cards ===
await go(page, 230, 140, 260); await page.waitForTimeout(300);
await go(page, 430, 140, 250); await page.waitForTimeout(300);
await go(page, 620, 140, 250); await page.waitForTimeout(300);
await go(page, 820, 140, 250); await page.waitForTimeout(300);
await hov(page, '.fp-monitor-card,.fp-monitor-row', 4, 280);

// === 2. Open first monitor detail ===
const firstCard = page.locator('.fp-monitor-card,.fp-monitor-row').first();
const fcBox = await firstCard.boundingBox().catch(() => null);
if (fcBox && fcBox.x > 150) {
  await go(page, fcBox.x + fcBox.width * 0.5, fcBox.y + fcBox.height / 2, 290);
  await page.waitForTimeout(80);
  await page.mouse.click(fcBox.x + fcBox.width * 0.5, fcBox.y + fcBox.height / 2);
  await page.waitForTimeout(1400); await inj(page);
} else {
  await page.evaluate(() => {
    const m = (window.STATE?.monitors || [])[0];
    if (m && window.openFloatPanel && window.renderMonitorDetailPanel)
      window.openFloatPanel('Détail monitor', window.renderMonitorDetailPanel(m));
  });
  await page.waitForTimeout(1300); await inj(page);
}

// === 3. Monitor panel — show uptime, latence, historique ===
const panel = page.locator('.fp-float-panel').first();
const pb = await panel.boundingBox().catch(() => null);
if (pb) {
  await go(page, pb.x + 50, pb.y + 90, 240); await page.waitForTimeout(380);
  await go(page, pb.x + pb.width * 0.4, pb.y + 100, 230); await page.waitForTimeout(380);
  await go(page, pb.x + pb.width * 0.7, pb.y + 100, 230); await page.waitForTimeout(380);
  await go(page, pb.x + pb.width * 0.9, pb.y + 100, 230); await page.waitForTimeout(380);
  await sc(page, 110, 380); await page.waitForTimeout(450);
  await go(page, pb.x + pb.width / 2, pb.y + 180, 230); await page.waitForTimeout(400);
  await sc(page, 90, 350); await page.waitForTimeout(400);
}

// === 4. Incidents tab ===
const incClicked = await cl(page, '.fp-tab:has-text("Incidents"),button:has-text("Incidents"),[role="tab"]:has-text("Incidents")', 700, 250);
if (incClicked) {
  const incItem = page.locator('.fp-incident-item,.fp-incident-row,tr').first();
  const ib = await incItem.boundingBox().catch(() => null);
  if (ib && ib.x > 150) { await go(page, ib.x + ib.width / 2, ib.y + ib.height / 2, 250); await page.waitForTimeout(500); }
  await page.waitForTimeout(300);
}
await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500); await inj(page);

// === 5. Navigate to Alertes ===
// Wait for alerts data (also Phase 3)
await page.waitForFunction(() => window.STATE?.route !== undefined, { timeout: 3000, polling: 200 }).catch(() => {});
await sidebarNav(page, 'alerts-center');
await page.waitForTimeout(1000); await inj(page);

// === 6. Show Alert Command Center content ===
await go(page, 640, 200, 250); await page.waitForTimeout(350);
await hov(page, '.fp-stat-card,.fp-kpi-card', 4, 250);
await sc(page, 100, 350); await page.waitForTimeout(400);
await go(page, 640, 300, 240); await page.waitForTimeout(400);

// === 7. Click first alert item / open Incidents tab ===
const incBtn = await cl(page, '.fp-tab:has-text("Incidents"),button:has-text("Incidents"),[role="tab"]:has-text("Incidents")', 600, 240);
if (!incBtn) {
  const alertItem = page.locator('.fp-alert-item,.fp-alert-row').first();
  const ab = await alertItem.boundingBox().catch(() => null);
  if (ab && ab.x > 150) {
    await go(page, ab.x + ab.width / 2, ab.y + ab.height / 2, 250);
    await page.waitForTimeout(180);
    await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
    await page.waitForTimeout(500); await inj(page);
  }
}
await sc(page, 100, 320); await page.waitForTimeout(300);
await hov(page, '.fp-alert-rule-row', 2, 250);
await go(page, 640, 360, 230); await page.waitForTimeout(500);

await page.close(); await ctx.close(); await browser.close();

const files = readdirSync(TMP).filter(f => f.endsWith('.webm'));
const mp4 = join(TMP, 'step3.mp4');
const ss = Math.max(0, (skip - 400) / 1000);
const args = ['-y']; if (ss > 0.5) args.push('-ss', ss.toFixed(2));
args.push('-i', join(TMP, files[0]), '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
spawnSync('ffmpeg', args, { stdio: 'pipe' });
spawnSync('cp', [mp4, join(DEST, 'step3-monitoring-alerts.mp4')]);
const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString().trim();
console.log(`✓ V3c step3-monitoring-alerts.mp4  ${parseFloat(dur).toFixed(1)}s`);
mkdirSync('/tmp/fv3c', { recursive: true });
for (const t of [1, 5, 10, 16, 22, 28, 34]) spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/fv3c/t${t}.jpg`], { stdio: 'pipe' });
console.log('V3c frames ok');
