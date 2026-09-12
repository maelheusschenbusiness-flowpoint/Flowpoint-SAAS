/**
 * V2 — Audits SEO → résultat → mission → monitoring → Core Web Vitals
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v2'; mkdirSync(TMP, { recursive: true });
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
    const w = document.createElement('div');
    w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s;
    document.body.appendChild(w);
    let cx = 640, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left = cx + 'px'; w.style.top = cy + 'px'; }, { passive: true });
    window._cx = cx; window._cy = cy;
  }, CSR);
}

async function go(p, tx, ty, ms = 450) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(16, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e));
    await p.waitForTimeout(14);
  }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}

async function cl(p, s, ams = 600, mms = 400) {
  try {
    const el = p.locator(s).first();
    if (!await el.isVisible({ timeout: 4000 }).catch(() => false)) return false;
    const b = await el.boundingBox();
    if (!b || b.x < 150) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms);
    await p.waitForTimeout(80);
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(ams);
    await inj(p);
    return true;
  } catch { return false; }
}

async function fi(p, s, t) {
  try {
    const el = p.locator(s).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox();
    if (!b) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 320);
    await el.click();
    await p.waitForTimeout(180);
    await el.fill(t);
    await p.waitForTimeout(200);
    return true;
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

// Navigate directly to Audits (page already has 1 audit with score 93)
await page.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
try { await page.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 25000, polling: 300 }); } catch { await page.waitForTimeout(3000); }
await page.waitForTimeout(1500);
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")', 'button:has-text("Skip")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click(); await page.waitForTimeout(400); break; } } catch {}
}

await page.evaluate(() => { if (window.navigate) window.navigate('audits'); });
await page.waitForTimeout(2500);
await page.waitForFunction(() => document.querySelectorAll('tr[data-audit-id]').length > 0, { timeout: 8000, polling: 300 }).catch(() => {});
await page.waitForTimeout(800);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// 1. Hover audit row → see score 93
const auditRow = page.locator('tr[data-audit-id]').first();
const auditBox = await auditRow.boundingBox().catch(() => null);
if (auditBox) {
  await go(page, auditBox.x + auditBox.width * 0.4, auditBox.y + auditBox.height / 2, 400);
  await page.waitForTimeout(600);
  await go(page, auditBox.x + auditBox.width * 0.6, auditBox.y + auditBox.height / 2, 300);
  await page.waitForTimeout(400);
}

// 2. Click audit row → open detail panel
await page.evaluate(() => {
  const audit = (window.STATE?.audits || [])[0];
  if (audit && window.openFloatPanel && window.renderAuditDetailPanel) {
    window.openFloatPanel("Détail de l'audit", window.renderAuditDetailPanel(audit));
  }
});
await page.waitForTimeout(1800);
await inj(page);

// 3. Scroll through audit detail panel → show score + recommendations
const panel = page.locator('.fp-float-panel, .fp-panel-body, .fp-panel-content').first();
const panelBox = await panel.boundingBox().catch(() => null);
if (panelBox) {
  await go(page, panelBox.x + panelBox.width / 2, panelBox.y + 120, 350);
  await page.waitForTimeout(400);
  await sc(page, 120, 500);
  await page.waitForTimeout(600);
  await go(page, panelBox.x + panelBox.width * 0.6, panelBox.y + 200, 280);
  await page.waitForTimeout(500);
  await sc(page, 120, 400);
  await page.waitForTimeout(500);
  await sc(page, -100, 350);
  await page.waitForTimeout(400);
}

// 4. Click "Créer mission" from audit panel
const missionFromAudit = await cl(page, 'button:has-text("Créer mission"),button:has-text("Mission"),button:has-text("Créer une mission")', 800, 350);
if (!missionFromAudit) {
  // Close panel and create mission directly
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => { if (window.navigate) window.navigate('missions'); });
  await page.waitForTimeout(1800);
}

// 5. Create mission
await cl(page, '#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Mission")', 500, 380);
await fi(page, 'input[placeholder*="Titre"],input[placeholder*="Nom"],input[id*="mission"]', 'Corriger les 4 issues SEO détectées');
await page.waitForTimeout(250);
await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1200, 320);
await page.waitForTimeout(400);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(400);
await inj(page);

// 6. Navigate to Monitoring
await page.evaluate(() => { if (window.navigate) window.navigate('monitors'); });
await page.waitForTimeout(2000);
await page.waitForFunction(() => document.querySelectorAll('.fp-monitor-card,.fp-monitor-row').length > 0, { timeout: 8000, polling: 300 }).catch(() => {});
await page.waitForTimeout(600);

// Hover monitor cards (show the DOWN status)
const monCards = page.locator('.fp-monitor-card,.fp-monitor-row');
const mc = Math.min(await monCards.count(), 3);
for (let i = 0; i < mc; i++) {
  const b = await monCards.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 350); await page.waitForTimeout(350); }
}

// 7. Create new monitor
await cl(page, 'button:has-text("+ Nouveau"),button:has-text("Nouveau monitor"),button:has-text("Ajouter un monitor")', 600, 380);
await page.waitForTimeout(500);
await fi(page, 'input[placeholder*="URL"],input[type="url"],input[name="url"]', 'https://example.com/services');
await page.waitForTimeout(300);
await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1400, 320);
await page.waitForTimeout(400);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(600);
await inj(page);

// 8. Show monitors list with new monitor
await page.evaluate(() => { window._cx = 640; window._cy = 360; });
await go(page, 640, 350, 300);
await page.waitForTimeout(500);

// 9. Navigate to Core Web Vitals
await page.evaluate(() => { if (window.navigate) window.navigate('core-web-vitals'); });
await page.waitForTimeout(2000);
await inj(page);

// Show CWV page content
await go(page, 640, 280, 350);
await page.waitForTimeout(600);
await go(page, 500, 400, 300);
await page.waitForTimeout(500);
// Click "Analyser un site" or hover the CWV empty state
const cwvBtn = page.locator('button:has-text("Analyser un site"),button:has-text("Analyse"),button:has-text("Performance")').first();
const cwvBox = await cwvBtn.boundingBox().catch(() => null);
if (cwvBox && cwvBox.x > 150) {
  await go(page, cwvBox.x + cwvBox.width / 2, cwvBox.y + cwvBox.height / 2, 350);
  await page.waitForTimeout(700);
}
await go(page, 640, 350, 280);
await page.waitForTimeout(800);

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

mkdirSync('/tmp/frm2', { recursive: true });
for (const t of [1, 5, 10, 16, 22, 28, 34, 40]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm2/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
