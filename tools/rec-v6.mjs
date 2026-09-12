/**
 * V6 — Utilisation quotidienne : mission + Activité + Notifs + Messages + Recherche + Overview
 * Les boutons header sont cliqués via page.evaluate() pour contourner la zone y<56
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v6'; mkdirSync(TMP, { recursive: true });
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
async function fi(p, s, t) {
  try {
    const el = p.locator(s).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox();
    if (!b) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 280);
    await el.click(); await p.waitForTimeout(150); await el.fill(t); await p.waitForTimeout(200);
    return true;
  } catch { return false; }
}
async function sc(p, d, ms = 500) {
  const n = Math.max(6, Math.round(ms / 30));
  for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); }
  await p.waitForTimeout(100);
}

// Click a header button by ID via JS (bypasses coordinate safe-zone)
async function hdrClick(p, id, waitMs = 900) {
  const clicked = await p.evaluate(btnId => {
    const el = document.getElementById(btnId);
    if (el) { el.click(); return true; }
    return false;
  }, id);
  if (clicked) await p.waitForTimeout(waitMs);
  await inj(p);
  return clicked;
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

// Navigate to Missions (3 actives)
await page.evaluate(() => { if (window.navigate) window.navigate('missions'); });
await page.waitForTimeout(2200);
await page.waitForFunction(() => document.querySelectorAll('table tbody tr,.mission-item,.fp-mission-row').length > 0, { timeout: 8000, polling: 300 }).catch(() => {});
await page.waitForTimeout(700);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// 1. Hover missions list + stat blocs
for (const [x, y] of [[220, 165], [430, 165], [630, 165], [820, 165]]) {
  await go(page, x, y, 300); await page.waitForTimeout(250);
}
const mrows = page.locator('table tbody tr,.fp-mission-row,.mission-item');
const mCnt = Math.min(await mrows.count(), 3);
for (let i = 0; i < mCnt; i++) {
  const b = await mrows.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 340); await page.waitForTimeout(300); }
}

// 2. Open mission detail (click first row)
if (mCnt > 0) {
  const mb = await mrows.first().boundingBox().catch(() => null);
  if (mb && mb.x > 150) {
    await go(page, mb.x + mb.width * 0.4, mb.y + mb.height / 2, 300);
    await page.waitForTimeout(200);
    await page.mouse.click(mb.x + mb.width * 0.4, mb.y + mb.height / 2);
    await page.waitForTimeout(1200);
    await inj(page);
  }
}

// 3. Change mission status via select in panel
const statusChanged = await page.evaluate(() => {
  const sel = document.querySelector('.mission-status-select,select[data-id]');
  if (sel) {
    const opts = [...sel.options];
    const nextOpt = opts.find(o => o.value !== sel.value && o.value);
    if (nextOpt) { sel.value = nextOpt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  }
  return false;
});
if (statusChanged) { await page.waitForTimeout(600); await inj(page); }

// Close panel
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(500);
await inj(page);

// 4. ACTIVITÉ — click via JS
const actOpened = await hdrClick(page, 'fp-activity-btn', 1000);
if (actOpened) {
  // Move cursor into activity panel to show content
  const actPanel = page.locator('#fp-activity-panel,.fp-activity-panel,.fp-activity-dropdown').first();
  const ap = await actPanel.boundingBox().catch(() => null);
  if (ap) {
    await go(page, ap.x + ap.width / 2, ap.y + 80, 300);
    await page.waitForTimeout(400);
    // Hover activity items
    const actItems = page.locator('.fp-activity-item,.fp-activity-row');
    const aiCnt = Math.min(await actItems.count(), 3);
    for (let i = 0; i < aiCnt; i++) {
      const b = await actItems.nth(i).boundingBox().catch(() => null);
      if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 280); await page.waitForTimeout(300); }
    }
    await page.waitForTimeout(400);
  }
  // Close by clicking outside
  await page.mouse.click(400, 450); await page.waitForTimeout(500); await inj(page);
}

// 5. NOTIFICATIONS — click via JS
const notifOpened = await hdrClick(page, 'fp-notif-btn', 900);
if (notifOpened) {
  const notifDrop = page.locator('#fp-notif-dropdown,.fp-notif-dropdown,.fp-notif-panel').first();
  const nd = await notifDrop.boundingBox().catch(() => null);
  if (nd) {
    await go(page, nd.x + nd.width / 2, nd.y + 60, 300);
    await page.waitForTimeout(400);
    const notifItems = page.locator('.fp-notif-item,.notification-item');
    const niCnt = Math.min(await notifItems.count(), 3);
    for (let i = 0; i < niCnt; i++) {
      const b = await notifItems.nth(i).boundingBox().catch(() => null);
      if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 270); await page.waitForTimeout(300); }
    }
    // Click first notification to open it
    if (niCnt > 0) {
      const nb = await notifItems.first().boundingBox().catch(() => null);
      if (nb && nb.x > 150) {
        await go(page, nb.x + nb.width / 2, nb.y + nb.height / 2, 250);
        await page.waitForTimeout(200);
        await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
        await page.waitForTimeout(700);
        await inj(page);
      }
    }
  }
  await page.mouse.click(400, 450); await page.waitForTimeout(500); await inj(page);
}

// 6. MESSAGES — click via JS
const msgOpened = await hdrClick(page, 'fp-msg-btn', 900);
if (msgOpened) {
  const msgDrop = page.locator('#fp-msg-dropdown,.fp-msg-dropdown,.fp-msg-panel').first();
  const md = await msgDrop.boundingBox().catch(() => null);
  if (md) {
    await go(page, md.x + md.width / 2, md.y + 70, 300);
    await page.waitForTimeout(400);
    // Click channel button (general)
    const chanBtn = page.locator('.fp-msg-channel-btn,.fp-channel-btn').first();
    const cb = await chanBtn.boundingBox().catch(() => null);
    if (cb && cb.x > 150) {
      await go(page, cb.x + cb.width / 2, cb.y + cb.height / 2, 280);
      await page.waitForTimeout(200);
      await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.waitForTimeout(600);
      await inj(page);
    }
    // Hover messages
    const msgItems = page.locator('.fp-msg-item,.fp-message-item,.fp-chat-msg');
    const miCnt = Math.min(await msgItems.count(), 2);
    for (let i = 0; i < miCnt; i++) {
      const b = await msgItems.nth(i).boundingBox().catch(() => null);
      if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 250); await page.waitForTimeout(300); }
    }
    await page.waitForTimeout(500);
  }
  await page.mouse.click(400, 450); await page.waitForTimeout(500); await inj(page);
}

// 7. RECHERCHE GLOBALE via JS
const searchOpened = await page.evaluate(() => {
  const btn = document.getElementById('fp-search-trigger');
  if (btn) { btn.click(); return true; }
  return false;
});
await page.waitForTimeout(800);
await inj(page);

if (searchOpened) {
  // Type in search
  const searchInput = page.locator('#fp-cmd-palette .fp-cmd-input,.fp-search-input,.fp-cmd-input').first();
  const si = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (si) {
    await searchInput.fill('monitor');
    await page.waitForTimeout(600);
    // Hover results
    const results = page.locator('.fp-cmd-item,.fp-search-result,.fp-cmd-result');
    const rCnt = Math.min(await results.count(), 3);
    for (let i = 0; i < rCnt; i++) {
      const b = await results.nth(i).boundingBox().catch(() => null);
      if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 260); await page.waitForTimeout(280); }
    }
    // Click first result
    if (rCnt > 0) {
      const rb = await results.first().boundingBox().catch(() => null);
      if (rb && rb.x > 150) {
        await go(page, rb.x + rb.width / 2, rb.y + rb.height / 2, 260);
        await page.waitForTimeout(200);
        await page.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2);
        await page.waitForTimeout(800);
        await inj(page);
      }
    } else {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    }
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

// 8. Return to Overview
await page.evaluate(() => { if (window.navigate) window.navigate('overview'); });
await page.waitForTimeout(2000);
await inj(page);
// Hover KPI cards
const kpis = page.locator('.fp-kpi-card,.kpi-card,.fp-stat-card');
const kCnt = Math.min(await kpis.count(), 4);
for (let i = 0; i < kCnt; i++) {
  const b = await kpis.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 300); await page.waitForTimeout(280); }
}
await page.waitForTimeout(600);

await page.close(); await ctx.close(); await browser.close();

const files = readdirSync(TMP).filter(f => f.endsWith('.webm'));
const mp4 = join(TMP, 'step6.mp4');
const ss = Math.max(0, (skip - 400) / 1000);
const args = ['-y'];
if (ss > 0.5) args.push('-ss', ss.toFixed(2));
args.push('-i', join(TMP, files[0]),
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
spawnSync('ffmpeg', args, { stdio: 'pipe' });
spawnSync('cp', [mp4, join(DEST, 'step6-daily.mp4')]);

const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString().trim();
console.log(`✓ step6-daily.mp4  ${parseFloat(dur).toFixed(1)}s`);

mkdirSync('/tmp/frm6', { recursive: true });
for (const t of [1, 5, 10, 15, 20, 25, 30, 35]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm6/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
