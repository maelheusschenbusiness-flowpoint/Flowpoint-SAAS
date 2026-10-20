/**
 * V2 final — Audits SEO → panneau détail → missions → monitoring → CWV
 * Fix: clic direct sur la ligne audit (pas JS eval), sidebar click pour navigation
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-fv2'; mkdirSync(TMP, { recursive: true });
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
async function go(p, tx, ty, ms = 400) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(14, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) { const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e)); await p.waitForTimeout(14); }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}
async function sidebarNav(p, route) {
  // Navigate via JS click on sidebar link (bypasses x<150 restriction)
  await p.evaluate(r => {
    const el = document.querySelector(`.fp-nav-item[data-route="${r}"]`);
    if (el) el.click();
    else if (window.navigate) window.navigate(r);
  }, route);
  await p.waitForFunction(r => window.STATE?.route === r, route, { timeout: 8000, polling: 200 }).catch(() => {});
  await p.waitForTimeout(500);
}
async function cl(p, s, ams = 500, mms = 340) {
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
    const b = await el.boundingBox(); if (!b) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 260); await el.click(); await p.waitForTimeout(130); await el.fill(t); await p.waitForTimeout(160); return true;
  } catch { return false; }
}
async function hov(p, s, max = 3, d = 280) {
  const it = p.locator(s); const n = Math.min(await it.count(), max);
  for (let i = 0; i < n; i++) { const b = await it.nth(i).boundingBox().catch(() => null); if (b && b.x > 150) { await go(p, b.x + b.width / 2, b.y + b.height / 2, 300); await p.waitForTimeout(d); } }
}
async function sc(p, d, ms = 380) {
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
  try { sessionStorage.setItem('fp_last_route', 'audits'); } catch {}
}, token);
const page = await ctx.newPage();
const t0 = Date.now();

await page.goto(BASE + '/dashboard.html#audits', { waitUntil: 'domcontentloaded', timeout: 30000 });
try {
  await page.waitForFunction(
    () => window.STATE?.loading === false && (window.STATE?.audits || []).length > 0,
    { timeout: 28000, polling: 300 }
  );
} catch { await page.waitForTimeout(4000); }

await sidebarNav(page, 'audits');
await page.waitForFunction(() => document.querySelectorAll('tr[data-audit-id]').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click(); await page.waitForTimeout(250); } } catch {}
}
await page.waitForTimeout(500);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// === 1. AUDITS PAGE — hover row, show score 93 ===
await hov(page, 'tr[data-audit-id]', 1, 700);

// === 2. Click audit row to open detail panel ===
const auditRow = page.locator('tr[data-audit-id]').first();
const arBox = await auditRow.boundingBox().catch(() => null);
if (arBox && arBox.x > 0) {
  // Click in the middle-right area (avoid checkbox)
  const cx = Math.max(300, arBox.x + arBox.width * 0.5);
  const cy = arBox.y + arBox.height / 2;
  await go(page, cx, cy, 320);
  await page.waitForTimeout(80);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(1600);
  await inj(page);
}

// === 3. If panel didn't open, try JS fallback ===
const panelVisible = await page.evaluate(() => !!document.querySelector('.fp-float-panel'));
if (!panelVisible) {
  await page.evaluate(() => {
    const audit = (window.STATE?.audits || [])[0];
    if (audit && window.renderAuditDetailPanel && window.openFloatPanel) {
      window.openFloatPanel("Détail de l'audit", window.renderAuditDetailPanel(audit));
    }
  });
  await page.waitForTimeout(1200);
  await inj(page);
}

// === 4. Scroll audit panel — show score, catégories, problèmes ===
const panel = page.locator('.fp-float-panel').first();
const pb = await panel.boundingBox().catch(() => null);
if (pb) {
  await go(page, pb.x + pb.width * 0.5, pb.y + 80, 250);
  await page.waitForTimeout(500);
  // Show score section
  await go(page, pb.x + pb.width * 0.7, pb.y + 130, 240);
  await page.waitForTimeout(500);
  // Scroll to catégories section
  await sc(page, 120, 420);
  await page.waitForTimeout(600);
  await go(page, pb.x + pb.width * 0.5, pb.y + 200, 230);
  await page.waitForTimeout(500);
  // Scroll to problèmes/recommandations
  await sc(page, 120, 380);
  await page.waitForTimeout(600);
  await go(page, pb.x + pb.width * 0.5, pb.y + 250, 230);
  await page.waitForTimeout(500);
}

// === 5. Close panel ===
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(400);
await inj(page);

// === 6. MISSIONS — create from audit finding ===
await sidebarNav(page, 'missions');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr,.fp-mission-row').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
await inj(page);

await cl(page, 'button:has-text("+ Mission"),button:has-text("Mission")', 500, 300);
await fi(page, 'input[placeholder*="Titre"],input[placeholder*="Nom"]', 'Corriger les balises title manquantes');
await page.waitForTimeout(200);
await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 900, 260);
await page.waitForTimeout(300);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(350);
await hov(page, 'table tbody tr,.fp-mission-row', 2, 260);
await inj(page);

// === 7. MONITORING — create monitor ===
await sidebarNav(page, 'monitors');
await page.waitForFunction(() => document.querySelectorAll('.fp-monitor-card,.fp-monitor-row').length > 0, { timeout: 6000, polling: 300 }).catch(() => {});
await inj(page);

await hov(page, '.fp-monitor-card,.fp-monitor-row', 3, 260);
await cl(page, 'button:has-text("+ Nouveau"),button:has-text("Nouveau monitor")', 450, 300);
await fi(page, 'input[placeholder*="URL"],input[type="url"]', 'https://example.com/services');
await page.waitForTimeout(220);
await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1000, 260);
await page.waitForTimeout(300);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(350);
await hov(page, '.fp-monitor-card,.fp-monitor-row', 2, 250);
await inj(page);

// === 8. CORE WEB VITALS ===
await sidebarNav(page, 'core-web-vitals');
await page.waitForTimeout(1200);
await inj(page);
await go(page, 640, 280, 250); await page.waitForTimeout(450);
await go(page, 500, 380, 230); await page.waitForTimeout(400);
// Hover "Analyser un site" button
const cwvBtn = page.locator('button:has-text("Analyser un site")').first();
const cb = await cwvBtn.boundingBox().catch(() => null);
if (cb && cb.x > 150) { await go(page, cb.x + cb.width / 2, cb.y + cb.height / 2, 260); await page.waitForTimeout(650); }
await go(page, 640, 360, 230); await page.waitForTimeout(600);

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
console.log(`✓ V2  step2-audit-actions.mp4  ${parseFloat(dur).toFixed(1)}s`);
mkdirSync('/tmp/fv2', { recursive: true });
for (const t of [1, 3, 6, 10, 14, 18, 22, 26]) spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/fv2/t${t}.jpg`], { stdio: 'pipe' });
console.log('V2 frames ok');
