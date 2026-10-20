/**
 * V3 — Monitoring détail + Incidents + Alertes
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v3'; mkdirSync(TMP, { recursive: true });
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
async function cl(p, s, ams = 600, mms = 400) {
  try {
    const el = p.locator(s).first();
    if (!await el.isVisible({ timeout: 4000 }).catch(() => false)) return false;
    const b = await el.boundingBox();
    if (!b || b.x < 150) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms);
    await p.waitForTimeout(80); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(ams); await inj(p); return true;
  } catch { return false; }
}
async function sc(p, d, ms = 500) {
  const n = Math.max(6, Math.round(ms / 30));
  for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); }
  await p.waitForTimeout(100);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: TMP, size: { width: 1280, height: 720 } },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
await ctx.addInitScript(tok => { try { sessionStorage.setItem('fp_session_token', tok); } catch {} }, token);
const page = await ctx.newPage();
const t0 = Date.now();

await page.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
try { await page.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 25000, polling: 300 }); } catch { await page.waitForTimeout(3000); }
await page.waitForTimeout(1500);
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click(); await page.waitForTimeout(300); break; } } catch {}
}

// Navigate to Monitors — page already loaded with 5 DOWN monitors
await page.evaluate(() => { if (window.navigate) window.navigate('monitors'); });
await page.waitForTimeout(2200);
await page.waitForFunction(() => document.querySelectorAll('.fp-monitor-card,.fp-monitor-row').length > 0, { timeout: 8000, polling: 300 }).catch(() => {});
await page.waitForTimeout(600);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// 1. Hover monitor list to show DOWN statuses
const cards = page.locator('.fp-monitor-card,.fp-monitor-row');
const cnt = Math.min(await cards.count(), 4);
for (let i = 0; i < cnt; i++) {
  const b = await cards.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 340); await page.waitForTimeout(320); }
}

// 2. Open monitor detail for first monitor (has incident)
await page.evaluate(() => {
  const m = (window.STATE?.monitors || [])[0];
  if (m && window.openFloatPanel && window.renderMonitorDetailPanel) {
    window.openFloatPanel('Détail monitor', window.renderMonitorDetailPanel(m));
  } else if (m) {
    // Fallback: click the row
    const row = document.querySelector('.fp-monitor-card,.fp-monitor-row');
    if (row) row.click();
  }
});
await page.waitForTimeout(1800);
await inj(page);

// 3. Show uptime in panel
const panelBody = page.locator('.fp-float-panel,.fp-panel-body,.fp-panel-content').first();
const pb = await panelBody.boundingBox().catch(() => null);
if (pb) {
  await go(page, pb.x + pb.width * 0.4, pb.y + 100, 300);
  await page.waitForTimeout(500);
  await go(page, pb.x + pb.width * 0.7, pb.y + 130, 280);
  await page.waitForTimeout(500);
  // Scroll to see latence and historique
  await sc(page, 100, 450);
  await page.waitForTimeout(600);
  await go(page, pb.x + pb.width / 2, pb.y + 180, 280);
  await page.waitForTimeout(500);
  await sc(page, 80, 350);
  await page.waitForTimeout(500);
}

// 4. Click Incidents tab within panel
const incTab = await cl(page, '.fp-tab:has-text("Incidents"),button:has-text("Incidents"),[role="tab"]:has-text("Incidents")', 900, 300);
if (incTab) {
  // Hover incident item
  await page.waitForTimeout(600);
  const incItem = page.locator('.fp-incident-item,.fp-monitor-incident,tr').first();
  const ib = await incItem.boundingBox().catch(() => null);
  if (ib && ib.x > 150) { await go(page, ib.x + ib.width / 2, ib.y + ib.height / 2, 300); await page.waitForTimeout(500); }
}
await page.waitForTimeout(400);

// 5. Close panel
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(600);
await inj(page);

// 6. Navigate to Alertes (alerts-center)
await page.evaluate(() => { if (window.navigate) window.navigate('alerts-center'); });
await page.waitForTimeout(2200);
await inj(page);

// 7. Show alert items (synthesized from DOWN monitors)
const alertItems = page.locator('.fp-alert-item,.fp-alert-row');
const aCnt = Math.min(await alertItems.count(), 3);
for (let i = 0; i < aCnt; i++) {
  const b = await alertItems.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 340); await page.waitForTimeout(380); }
}

// 8. Hover KPI cards in alerts-center
const kpiCards = page.locator('.fp-stat-card,.fp-kpi-card');
const kCnt = Math.min(await kpiCards.count(), 4);
for (let i = 0; i < kCnt; i++) {
  const b = await kpiCards.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 300); await page.waitForTimeout(300); }
}

// 9. If alert items visible, click first one to open detail
if (aCnt > 0) {
  const ab = await alertItems.first().boundingBox().catch(() => null);
  if (ab && ab.x > 150) {
    await go(page, ab.x + ab.width / 2, ab.y + ab.height / 2, 300);
    await page.waitForTimeout(200);
    await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
    await page.waitForTimeout(800);
    await inj(page);
  }
}
// Also try alert rule rows
await page.waitForTimeout(300);
const ruleRows = page.locator('.fp-alert-rule-row');
const rCnt = Math.min(await ruleRows.count(), 2);
for (let i = 0; i < rCnt; i++) {
  const b = await ruleRows.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 300); await page.waitForTimeout(350); }
}
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

mkdirSync('/tmp/frm3', { recursive: true });
for (const t of [1, 5, 10, 15, 20, 25, 30]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm3/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
