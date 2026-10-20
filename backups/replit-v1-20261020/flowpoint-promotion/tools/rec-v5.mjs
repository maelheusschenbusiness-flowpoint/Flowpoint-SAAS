/**
 * V5 — Assistant IA (réponse texte visible) + Génération rapport SEO
 * Technique : window.navigate bloqué temporairement pour maintenir le chat visible
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-v5'; mkdirSync(TMP, { recursive: true });
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

// Navigate to AI assistant
await page.evaluate(() => { if (window.navigate) window.navigate('ai'); });
await page.waitForTimeout(2500);
await page.waitForFunction(() => document.querySelector('#fp-chat-input,textarea[placeholder*="message"],textarea[placeholder*="priorit"]') !== null, { timeout: 10000, polling: 300 }).catch(() => {});
await page.waitForTimeout(800);
const skip = Date.now() - t0;

await page.mouse.move(640, 360); await page.evaluate(() => { window._cx = 640; window._cy = 360; }); await inj(page);

// 1. Hover prompt chips to show them
const chips = page.locator('.fp-quick-chip,.fp-suggestion-chip,button:has-text("Que faire en priorité")');
const chipCnt = Math.min(await chips.count(), 3);
for (let i = 0; i < chipCnt; i++) {
  const b = await chips.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 320); await page.waitForTimeout(350); }
}
await page.waitForTimeout(300);

// 2. Block window.navigate so AI response stays visible in chat
await page.evaluate(() => {
  window._origNavigate = window.navigate;
  window._navBlocked = true;
  window.navigate = (sec) => { window._blockedNavTarget = sec; console.log('[REC] navigate blocked → ' + sec); };
});

// 3. Fill the textarea and send question
const textarea = page.locator('#fp-chat-input,textarea').first();
const tb = await textarea.boundingBox().catch(() => null);
if (tb && tb.x > 150) {
  await go(page, tb.x + tb.width / 2, tb.y + tb.height / 2, 320);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const el = document.querySelector('#fp-chat-input,textarea');
    if (el) { el.focus(); el.value = 'Quelles sont mes priorités SEO cette semaine ?'; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(300);
}

// 4. Click send button
await cl(page, '#fp-chat-send,button[aria-label*="Envoyer"],button[type="submit"]:has-text("Envoyer"),#fp-send-btn', 400, 280);

// 5. Wait for AI response text to appear (streaming bubble)
const responseAppeared = await page.waitForFunction(() => {
  const msgs = document.querySelectorAll('.fp-ai-msg,.fp-ai-bubble,.fp-chat-response,.fp-msg-ai,.fp-ai-text');
  for (const m of msgs) {
    if (m.textContent && m.textContent.trim().length > 30 && !m.querySelector('.fp-typing-indicator')) return true;
  }
  return false;
}, { timeout: 20000, polling: 300 }).catch(() => null);

console.log('AI response appeared:', !!responseAppeared);

// 6. Show the response for 6 seconds
await page.mouse.move(640, 380); await page.evaluate(() => { window._cx = 640; window._cy = 380; });
await page.waitForTimeout(2000);
// Scroll down to see more of the response
const chatArea = page.locator('#fp-chat-messages,.fp-chat-body,.fp-ai-chat').first();
const ca = await chatArea.boundingBox().catch(() => null);
if (ca) {
  await go(page, ca.x + ca.width / 2, ca.y + ca.height * 0.7, 280);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2500);
await inj(page);
await page.waitForTimeout(1000);

// 7. Release navigate block and go to Rapports
await page.evaluate(() => {
  window._navBlocked = false;
  if (window._origNavigate) window.navigate = window._origNavigate;
  window.navigate('reports');
});
await page.waitForTimeout(2200);
await inj(page);

// 8. Hover report cards
const reportCards = page.locator('.fp-report-card,.fp-template-card');
const rcCnt = Math.min(await reportCards.count(), 3);
for (let i = 0; i < rcCnt; i++) {
  const b = await reportCards.nth(i).boundingBox().catch(() => null);
  if (b && b.x > 150) { await go(page, b.x + b.width / 2, b.y + b.height / 2, 320); await page.waitForTimeout(350); }
}
await page.waitForTimeout(300);

// 9. Click "Rapport SEO" card (first one or the SEO-labelled one)
const seoCard = page.locator('.fp-report-card:has-text("SEO"),.fp-template-card:has-text("SEO")').first();
const seoBox = await seoCard.boundingBox().catch(() => null);
if (seoBox && seoBox.x > 150) {
  await go(page, seoBox.x + seoBox.width / 2, seoBox.y + seoBox.height / 2, 320);
  await page.waitForTimeout(200);
  await page.mouse.click(seoBox.x + seoBox.width / 2, seoBox.y + seoBox.height / 2);
  await page.waitForTimeout(800);
  await inj(page);
} else {
  // Fallback: click "Générer rapport" button
  await cl(page, 'button:has-text("Générer rapport"),button:has-text("Nouveau"),#report-new-btn', 800, 350);
}

// 10. Panel is open — show report form
const panelBody = page.locator('.fp-float-panel,.fp-panel-body').first();
const panelBox = await panelBody.boundingBox().catch(() => null);
if (panelBox) {
  await go(page, panelBox.x + panelBox.width / 2, panelBox.y + 100, 300);
  await page.waitForTimeout(600);
  // Try to select audit in the report form
  const auditSel = page.locator('#nr-audit,select[id*="audit"]').first();
  const aBox = await auditSel.boundingBox().catch(() => null);
  if (aBox && aBox.x > 150) {
    await go(page, aBox.x + aBox.width / 2, aBox.y + aBox.height / 2, 280);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const sel = document.getElementById('nr-audit');
      if (sel && sel.options.length > 1) sel.selectedIndex = 1;
    });
    await page.waitForTimeout(300);
  }
  await sc(page, 80, 400);
  await page.waitForTimeout(500);
  await go(page, panelBox.x + panelBox.width / 2, panelBox.y + 200, 280);
  await page.waitForTimeout(400);
}

// 11. Click "Générer" / "Créer" button in the panel
const genBtn = await cl(page, 'button:has-text("Générer"),button:has-text("Créer le rapport"),button:has-text("Créer"),button[type="submit"]', 1800, 320);
await page.waitForTimeout(800);
await inj(page);

// 12. Show generation result (toast or report in list)
await go(page, 640, 350, 300);
await page.waitForTimeout(1500);

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

mkdirSync('/tmp/frm5', { recursive: true });
for (const t of [1, 4, 7, 10, 14, 18, 22, 27, 32]) {
  spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/frm5/t${t}.jpg`], { stdio: 'pipe' });
}
console.log('frames extracted');
