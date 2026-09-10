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
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left=cx+'px'; w.style.top=cy+'px'; }, { passive: true });
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
  const { x, y } = await page.evaluate(() => ({ x: window._cx||640, y: window._cy||360 }));
  const n = Math.max(18, Math.round(ms/14));
  for (let i=1; i<=n; i++) {
    const t=i/n, e=t<.5?2*t*t:-1+(4-2*t)*t;
    await page.mouse.move(Math.round(x+(tx-x)*e), Math.round(y+(ty-y)*e));
    await page.waitForTimeout(14);
  }
  await page.evaluate(p => { window._cx=p.x; window._cy=p.y; }, { x:tx, y:ty });
}

async function scroll(page, delta, ms=600) {
  const n = Math.max(8, Math.round(ms/30));
  for (let i=0; i<n; i++) { await page.mouse.wheel(0, delta/n); await page.waitForTimeout(30); }
  await page.waitForTimeout(100);
}

async function $click(page, sel, afterMs=600, moveMs=420) {
  try {
    const el = page.locator(sel).first();
    if (!await el.isVisible({ timeout: 3500 }).catch(() => false)) return false;
    const b = await el.boundingBox(); if (!b) return false;
    await go(page, b.x+b.width/2, b.y+b.height/2, moveMs);
    await page.waitForTimeout(80);
    await page.mouse.click(b.x+b.width/2, b.y+b.height/2);
    await page.waitForTimeout(afterMs);
    await injectCursor(page); return true;
  } catch { return false; }
}

async function $type(page, sel, text, delay=58) {
  try {
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox(); if (!b) return false;
    await go(page, b.x+b.width/2, b.y+b.height/2, 350);
    await page.mouse.click(b.x+b.width/2, b.y+b.height/2);
    await page.waitForTimeout(160);
    await page.keyboard.type(text, { delay }); return true;
  } catch { return false; }
}

async function nav(page, route) {
  await page.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash=r; }, route);
  await page.waitForTimeout(1800); await injectCursor(page);
}

async function hoverItems(page, sel, max=3, dwellMs=320) {
  const items = page.locator(sel);
  const n = Math.min(await items.count(), max);
  for (let i=0; i<n; i++) {
    const b = await items.nth(i).boundingBox().catch(() => null);
    if (b && b.width > 40) { await go(page, b.x+b.width/2, b.y+b.height/2, 380); await page.waitForTimeout(dwellMs); }
  }
}

const token = await getToken();
console.log('Token ok. Recording step6-daily…');

const tmp = join(OUT_DIR, 't_v6');
mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width:1280, height:720 },
  recordVideo: { dir: tmp, size: { width:1280, height:720 } },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
await ctx.addInitScript(tok => {
  try { sessionStorage.setItem('fp_session_token', tok); } catch {}
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
}, token);

const page = await ctx.newPage();
const t0 = Date.now();

await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
try {
  await page.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 25000, polling: 300 });
} catch {
  await page.waitForSelector('h1,h2', { timeout: 12000 }).catch(() => {});
}
await page.waitForTimeout(2000);
// Dismiss onboarding
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")', 'button:has-text("Skip")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout:600 }).catch(() => false)) { await b.click(); await page.waitForTimeout(400); break; } } catch {}
}
await nav(page, 'missions');
await page.waitForSelector('table tbody tr,.mission-item', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(800);
const skip = Date.now() - t0;
await page.mouse.move(650, 350);
await page.evaluate(() => { window._cx=650; window._cy=350; });
await injectCursor(page);

// ── Missions : hover stat blocks + rows ──────────────────────────────────────
for (const [x,y] of [[220,160],[430,160],[630,160],[830,160]]) { await go(page,x,y,320); await page.waitForTimeout(260); }
await hoverItems(page, 'table tbody tr,.mission-item,.mission-row', 3, 380);

// ── Create a mission via + button ────────────────────────────────────────────
await $click(page, '#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Créer une mission"),button:has-text("+ Ajouter")', 600, 380);
await $type(page, 'input[placeholder*="Titre"],input[id*="mission"],input[placeholder*="Nom"],input[placeholder*="mission"]', 'Améliorer la page Contact', 57);
await page.waitForTimeout(280);
await $click(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"],#nm2-create', 1200, 320);
await page.waitForTimeout(300);
await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500); await injectCursor(page);

// ── Activité panel ───────────────────────────────────────────────────────────
if (await $click(page, '#fp-activity-btn,[aria-label*="ctivité"]', 1000, 400)) {
  await go(page, 1060, 250, 350); await page.waitForTimeout(350);
  await go(page, 1060, 330, 300); await page.waitForTimeout(320);
  await go(page, 1060, 400, 280); await page.waitForTimeout(320);
  await scroll(page, 60, 350); await page.waitForTimeout(300); await scroll(page, -60, 300);
  await page.mouse.click(350, 400); await page.waitForTimeout(400); await injectCursor(page);
}

// ── Notifications ────────────────────────────────────────────────────────────
if (await $click(page, '#fp-notif-btn', 900, 400)) {
  await go(page, 1000, 240, 350); await page.waitForTimeout(300);
  await hoverItems(page, '#fp-notif-dropdown .fp-notif-item,[id*="notif"] .notif-item', 3, 300);
  await page.mouse.click(400, 450); await page.waitForTimeout(400); await injectCursor(page);
}

// ── Messages ─────────────────────────────────────────────────────────────────
if (await $click(page, '#fp-msg-btn', 900, 400)) {
  await $click(page, '#fp-msg-dropdown .fp-msg-channel-btn,[id*="msg"] .channel-btn', 500, 320);
  const typed = await $type(page, '#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]', 'Rapport SEO semaine 37 envoyé ✓', 55);
  if (typed) {
    await page.waitForTimeout(280);
    await $click(page, '#fp-msg-send,button[aria-label*="Envoyer"]', 500, 280);
  }
  await page.mouse.click(400, 400); await page.waitForTimeout(400); await injectCursor(page);
}

// ── Back to Overview ─────────────────────────────────────────────────────────
await nav(page, 'overview');
await page.waitForSelector('.fp-kpi-card,.kpi-card,h1', { timeout: 6000 }).catch(() => {});
await hoverItems(page, '.fp-kpi-card,.kpi-card,[data-kpi]', 4, 330);
if (await page.locator('.fp-kpi-card,.kpi-card').count() === 0) {
  for (const [x,y] of [[280,200],[520,200],[760,200],[1000,200]]) { await go(page,x,y,330); await page.waitForTimeout(280); }
}
await scroll(page, 100, 500); await go(page, 640, 400, 320); await page.waitForTimeout(600); await scroll(page, -100, 450);
await page.waitForTimeout(600);

await page.close(); await ctx.close(); await browser.close();

const files = readdirSync(tmp).filter(f => f.endsWith('.webm'));
const mp4 = join(OUT_DIR, 'step6-daily.mp4');
const ss = Math.max(0, (skip-400)/1000);
const ffArgs = ['-y'];
if (ss > 0.5) ffArgs.push('-ss', ss.toFixed(2));
ffArgs.push('-i', join(tmp, files[0]),
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
spawnSync('ffmpeg', ffArgs, { stdio: 'pipe' });
spawnSync('cp', [mp4, join(DEST_DIR, 'step6-daily.mp4')]);
const dur = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4], { stdio:'pipe' }).stdout.toString().trim();
console.log(`✓ step6-daily.mp4  ${parseFloat(dur).toFixed(1)}s  (trimmed ${(skip/1000).toFixed(1)}s)`);

// Extract frames
for (const t of [1, 8, 20, 30]) {
  spawnSync('ffmpeg', ['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/vfull/s6v3-t${t}.jpg`], { stdio:'pipe' });
}
console.log('Frames extracted.');
