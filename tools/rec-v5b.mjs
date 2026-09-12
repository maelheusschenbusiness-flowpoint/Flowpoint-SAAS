/**
 * V5b — Assistant IA (réponse texte bloquant la nav) + Génération rapport SEO
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v5b'; mkdirSync(TMP, { recursive: true });
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
  try { sessionStorage.setItem('fp_last_route', 'ai'); } catch {}
}, token);
const page = await ctx.newPage();
const t0 = Date.now();

await page.goto(BASE + '/dashboard.html#ai', { waitUntil: 'domcontentloaded', timeout: 30000 });
try { await page.waitForFunction(() => window.STATE?.loading === false, { timeout: 25000, polling: 300 }); } catch { await page.waitForTimeout(3000); }

await navTo(page, 'ai');
await page.waitForFunction(() => !!document.querySelector('#fp-chat-input,textarea'), { timeout: 8000, polling: 300 }).catch(() => {});
for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
  try { const b = page.locator(s).first(); if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click(); await page.waitForTimeout(250); } } catch {}
}
await page.waitForTimeout(600);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// 1. Show AI page — greeting visible + hover quick chips
await go(page, 640, 240, 280);
await page.waitForTimeout(400);
await hov(page, '.fp-quick-chip,.fp-suggestion-chip', 3, 320);
await page.waitForTimeout(300);

// 2. Block window.navigate so AI response stays visible in the chat UI
await page.evaluate(() => {
  window._origNavigate = window.navigate;
  window.navigate = (sec) => { window._blockedNavTarget = sec; };
});

// 3. Fill textarea via JS and send
await page.evaluate(() => {
  const el = document.querySelector('#fp-chat-input,textarea[placeholder]');
  if (el) {
    el.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) nativeInputValueSetter.call(el, 'Quelles sont mes priorités SEO cette semaine ?');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(350);

// Move cursor to textarea to show the text
const ta = page.locator('#fp-chat-input,textarea').first();
const taBox = await ta.boundingBox().catch(() => null);
if (taBox && taBox.x > 150) await go(page, taBox.x + taBox.width / 2, taBox.y + taBox.height / 2, 280);
await page.waitForTimeout(300);

// Click send
await cl(page, '#fp-chat-send,#fp-send-btn,button[aria-label*="Envoyer"],form button[type="submit"]', 300, 250);

// 4. Wait for assistant response bubble to appear
const gotResponse = await page.waitForFunction(() => {
  const bubbles = document.querySelectorAll('.fp-ai-msg--assistant .fp-ai-msg-bubble,.fp-ai-msg[data-role="assistant"] .fp-ai-msg-bubble');
  for (const b of bubbles) {
    const txt = b.textContent?.trim() || '';
    if (txt.length > 20 && !b.closest('.fp-typing')) return true;
  }
  return false;
}, { timeout: 25000, polling: 200 }).catch(() => null);
console.log('AI response captured:', !!gotResponse);

// 5. Show the AI response — move cursor gently in the chat area
await go(page, 640, 380, 280);
await page.waitForTimeout(1800);
// Scroll to see more of the response
await sc(page, 80, 350);
await page.waitForTimeout(500);
await go(page, 660, 400, 250);
await page.waitForTimeout(1500);
await sc(page, 80, 300);
await page.waitForTimeout(600);
await inj(page);

// 6. Release navigate block → go to Rapports
await page.evaluate(() => {
  if (window._origNavigate) window.navigate = window._origNavigate;
  window.navigate('reports');
});
await page.waitForFunction(() => window.STATE?.route === 'reports', { timeout: 8000, polling: 200 }).catch(() => {});
await page.waitForTimeout(1200);
await inj(page);

// 7. Hover report cards (SEO, Exécutif, etc.)
await hov(page, '.fp-report-card,.fp-template-card', 3, 320);

// 8. Click "Rapport SEO" card
const seoCard = page.locator('.fp-report-card:has-text("SEO"),.fp-template-card:has-text("SEO")').first();
const scBox = await seoCard.boundingBox().catch(() => null);
if (scBox && scBox.x > 150) {
  await go(page, scBox.x + scBox.width / 2, scBox.y + scBox.height / 2, 300);
  await page.waitForTimeout(180);
  await page.mouse.click(scBox.x + scBox.width / 2, scBox.y + scBox.height / 2);
  await page.waitForTimeout(700);
  await inj(page);
} else {
  // Fallback: click "Générer rapport" button directly
  await cl(page, 'button:has-text("Générer rapport"),#report-new-btn,button:has-text("+ Nouveau")', 600, 300);
}

// 9. Panel open — show report form, select audit
const panelBody = page.locator('.fp-float-panel').first();
const panelBox = await panelBody.boundingBox().catch(() => null);
if (panelBox) {
  await go(page, panelBox.x + panelBox.width / 2, panelBox.y + 80, 260);
  await page.waitForTimeout(500);
  // Select audit in dropdown if available
  const auditSel = page.locator('#nr-audit,select[id*="audit"]').first();
  const aBox = await auditSel.boundingBox().catch(() => null);
  if (aBox && aBox.x > 150) {
    await go(page, aBox.x + aBox.width / 2, aBox.y + aBox.height / 2, 250);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const sel = document.getElementById('nr-audit');
      if (sel && sel.options.length > 1) { sel.selectedIndex = 1; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(250);
  }
  await sc(page, 60, 350);
  await page.waitForTimeout(400);
  await go(page, panelBox.x + panelBox.width * 0.6, panelBox.y + 180, 250);
  await page.waitForTimeout(300);
}

// 10. Click "Générer" button
await cl(page, 'button:has-text("Générer"),button:has-text("Créer le rapport"),button:has-text("Créer"),button[type="submit"]', 1500, 280);
await page.waitForTimeout(600);
await inj(page);

// 11. Show result (toast, or report in list)
await go(page, 640, 360, 260);
await page.waitForTimeout(1200);

await page.close(); await ctx.close(); await browser.close();

const files = readdirSync(TMP).filter(f => f.endsWith('.webm'));
const mp4 = join(TMP, 'step5.mp4');
const ss = Math.max(0, (skip - 400) / 1000);
const args = ['-y'];
if (ss > 0.5) args.push('-ss', ss.toFixed(2));
args.push('-i', join(TMP, files[0]),
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
spawnSync('ffmpeg', args, { stdio: 'pipe' });
spawnSync('cp', [mp4, join(DEST, 'step5-ai-reports.mp4')]);

const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString().trim();
console.log(`✓ step5-ai-reports.mp4  ${parseFloat(dur).toFixed(1)}s`);

mkdirSync('/tmp/frm5b', { recursive: true });
for (const t of [1, 4, 7, 10, 14, 18, 22, 27]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm5b/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
