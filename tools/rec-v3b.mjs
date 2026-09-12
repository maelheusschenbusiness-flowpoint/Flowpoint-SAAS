/**
 * V3b — Monitoring détail + Incidents + Alertes
 * Fix: navigate avec attente STATE.route
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v3b'; mkdirSync(TMP, { recursive: true });
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
async function go(p, tx, ty, ms = 430) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(14, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) { const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e)); await p.waitForTimeout(14); }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}
async function navTo(p, route) {
  await p.evaluate(s => { if (window.navigate) window.navigate(s); }, route);
  await p.waitForFunction(r => window.STATE?.route === r, route, { timeout: 8000, polling: 200 }).catch(() => {});
  await p.waitForTimeout(500);
}
async function cl(p, s, ams = 500, mms = 350) {
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
async function hov(p, s, max = 3, d = 280) {
  const it = p.locator(s); const n = Math.min(await it.count(), max);
  for (let i = 0; i < n; i++) { const b = await it.nth(i).boundingBox().catch(() => null); if (b && b.x > 150) { await go(p, b.x + b.width / 2, b.y + b.height / 2, 300); await p.waitForTimeout(d); } }
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
await ctx.addInitScript(tok => {
  try { sessionStorage.setItem('fp_session_token', tok); } catch {}
  try { sessionStorage.setItem('fp_last_route', 'monitors'); } catch {}
}, token);
const page = await ctx.newPage();
const t0 = Date.now();

await page.goto(BASE + '/dashboard.html#monitors', { waitUntil: 'domcontentloaded', timeout: 30000 });
try {
  await page.waitForFunction(
    () => typeof window.STATE !== 'undefined' && window.STATE.loading === false,
    { timeout: 25000, polling: 300 }
  );
} catch { await page.waitForTimeout(3000); }

await navTo(page, 'monitors');
await page.waitForFunction(() => document.querySelectorAll('.fp-monitor-card,.fp-monitor-row').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click(); await p.waitForTimeout(250); } } catch {}
}
await page.waitForTimeout(500);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// 1. Hover monitor cards — show DOWN status badges
await hov(page, '.fp-monitor-card,.fp-monitor-row', 4, 300);

// 2. Open monitor detail for first monitor (has 1 incident)
const firstMon = await page.evaluate(() => (window.STATE?.monitors || [])[0]);
if (firstMon) {
  await page.evaluate(m => {
    if (window.openFloatPanel && window.renderMonitorDetailPanel) {
      window.openFloatPanel('Détail monitor', window.renderMonitorDetailPanel(m));
    } else {
      // Fallback: click the first card
      document.querySelector('.fp-monitor-card,.fp-monitor-row')?.click();
    }
  }, firstMon);
} else {
  await cl(page, '.fp-monitor-card,.fp-monitor-row', 800, 350);
}
await page.waitForTimeout(1500);
await inj(page);

// 3. Show panel content: uptime, latence, historique
const panel = page.locator('.fp-float-panel,.fp-panel').first();
const pb = await panel.boundingBox().catch(() => null);
if (pb) {
  await go(page, pb.x + 60, pb.y + 90, 250);
  await page.waitForTimeout(400);
  await go(page, pb.x + pb.width * 0.5, pb.y + 120, 240);
  await page.waitForTimeout(450);
  await go(page, pb.x + pb.width * 0.8, pb.y + 120, 240);
  await page.waitForTimeout(400);
  await sc(page, 100, 380);
  await page.waitForTimeout(500);
  await go(page, pb.x + pb.width / 2, pb.y + 180, 250);
  await page.waitForTimeout(400);
}

// 4. Click Incidents tab in panel
const incTabClicked = await cl(page, '.fp-tab:has-text("Incidents"),button:has-text("Incidents"),[role="tab"]:has-text("Incidents")', 800, 270);
if (incTabClicked) {
  await page.waitForTimeout(500);
  // Hover incident item
  const incItem = page.locator('.fp-incident-item,.fp-incident-row,tr:has-text("unreachable"),tr:has-text("DOWN")').first();
  const ib = await incItem.boundingBox().catch(() => null);
  if (ib && ib.x > 150) {
    await go(page, ib.x + ib.width / 2, ib.y + ib.height / 2, 280);
    await page.waitForTimeout(500);
    // Click incident to see detail
    await page.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.waitForTimeout(600);
    await inj(page);
  }
}
await page.waitForTimeout(400);

// 5. Close panel
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(500);
await inj(page);

// === ALERTES (alerts-center) ===
await navTo(page, 'alerts-center');
await page.waitForTimeout(1200);
await inj(page);

// 6. Show KPI cards (5 critiques visible)
await hov(page, '.fp-stat-card,.fp-kpi-card', 4, 280);

// 7. Hover alert items (synthesized from DOWN monitors)
await hov(page, '.fp-alert-item,.fp-alert-row', 3, 300);

// 8. Click first alert item to open detail
const alertItems = page.locator('.fp-alert-item,.fp-alert-row');
if (await alertItems.count() > 0) {
  const ab = await alertItems.first().boundingBox().catch(() => null);
  if (ab && ab.x > 150) {
    await go(page, ab.x + ab.width / 2, ab.y + ab.height / 2, 260);
    await page.waitForTimeout(180);
    await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
    await page.waitForTimeout(700);
    await inj(page);
  }
}

// 9. Scroll to see rule rows
await sc(page, 80, 350);
await page.waitForTimeout(400);
await hov(page, '.fp-alert-rule-row', 2, 280);
await go(page, 640, 360, 250);
await page.waitForTimeout(500);

await page.close(); await ctx.close(); await browser.close();

const files = readdirSync(TMP).filter(f => f.endsWith('.webm'));
const mp4 = join(TMP, 'step3.mp4');
const ss = Math.max(0, (skip - 400) / 1000);
const args = ['-y'];
if (ss > 0.5) args.push('-ss', ss.toFixed(2));
args.push('-i', join(TMP, files[0]),
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
spawnSync('ffmpeg', args, { stdio: 'pipe' });
spawnSync('cp', [mp4, join(DEST, 'step3-monitoring-alerts.mp4')]);

const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString().trim();
console.log(`✓ step3-monitoring-alerts.mp4  ${parseFloat(dur).toFixed(1)}s`);

mkdirSync('/tmp/frm3b', { recursive: true });
for (const t of [1, 5, 9, 14, 19, 24, 29]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm3b/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
