/**
 * FlowPoint — Master recording script V2–V6
 *
 * Architecture:
 *  - boot(page, hash) navigates + waits for STATE.loading===false → returns skipMs
 *  - toMp4(webm, mp4, skipMs) trims the loading from the final video
 *  - Result: first visible frame = interface already loaded
 *
 * Dense scenarios, no idle > 3s, natural cursor (SVG arrow), real clicks/fills.
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE     = 'https://app.flowpoint.pro';
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const DEST     = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const TMP_ROOT = '/tmp/fp-master';
mkdirSync(TMP_ROOT, { recursive: true });

// ── Session ──────────────────────────────────────────────────────────────────
async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error('token fail: ' + JSON.stringify(d));
  console.log('  token ok');
  return d.token;
}

// ── Cursor (SVG arrow, no red dot) ───────────────────────────────────────────
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

// ── Mouse helpers ─────────────────────────────────────────────────────────────
async function go(p, tx, ty, ms = 420) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 640, y: window._cy || 360 }));
  const n = Math.max(14, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e));
    await p.waitForTimeout(14);
  }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}

async function sc(p, d, ms = 500) {
  const n = Math.max(6, Math.round(ms / 30));
  for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); }
  await p.waitForTimeout(100);
}

// Safe click: skip sidebar (x<170) and top-nav (y<55)
async function cl(p, sel, ams = 600, mms = 360) {
  try {
    const el = p.locator(sel).first();
    if (!await el.isVisible({ timeout: 4000 }).catch(() => false)) return false;
    const b = await el.boundingBox();
    if (!b || b.x < 155 || b.y < 52) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms);
    await p.waitForTimeout(70);
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(ams);
    await inj(p);
    return true;
  } catch { return false; }
}

// Fill using element.fill — no shortcut keys
async function fi(p, sel, text) {
  try {
    const el = p.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox(); if (!b) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 300);
    await el.click(); await p.waitForTimeout(160);
    await el.fill(text); await p.waitForTimeout(180);
    return true;
  } catch { return false; }
}

// Hover a list of items (safe zone)
async function hov(p, sel, max = 3, dw = 300) {
  const it = p.locator(sel);
  const n = Math.min(await it.count().catch(() => 0), max);
  for (let i = 0; i < n; i++) {
    const b = await it.nth(i).boundingBox().catch(() => null);
    if (b && b.x > 155 && b.y > 52 && b.width > 40) {
      await go(p, b.x + b.width / 2, b.y + b.height / 2, 360);
      await p.waitForTimeout(dw);
    }
  }
}

// Navigate using window.navigate (never click sidebar)
async function nav(p, route) {
  await p.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash = r; }, route);
  await p.waitForTimeout(1800);
  await inj(p);
}

// ── Boot: navigate + wait for full load → return skipMs (will be trimmed) ────
async function boot(p, hash) {
  const t0 = Date.now();
  await p.goto(`${BASE}/dashboard.html#${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await p.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 28000, polling: 300 });
  } catch {
    await p.waitForSelector('h1,h2,.fp-card', { timeout: 10000 }).catch(() => {});
  }
  await p.waitForTimeout(2200);
  // Dismiss onboarding modal if present
  for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")', 'button:has-text("Skip")']) {
    try {
      const b = p.locator(s).first();
      if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click(); await p.waitForTimeout(400); break; }
    } catch {}
  }
  // Ensure correct section
  const h = await p.evaluate(() => window.location.hash.replace('#', ''));
  if (h !== hash) {
    await p.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash = r; }, hash);
    await p.waitForTimeout(2200);
  }
  // Init cursor position
  await p.mouse.move(660, 360);
  await p.evaluate(() => { window._cx = 660; window._cy = 360; });
  await inj(p);
  return Date.now() - t0; // skipMs → loader gets cut from final video
}

// ── FFmpeg: convert webm → mp4, trim loading from start ──────────────────────
function toMp4(webm, mp4, skipMs = 0) {
  const ss = Math.max(0, (skipMs - 500) / 1000);
  const args = ['-y'];
  if (ss > 0.3) args.push('-ss', ss.toFixed(2));
  args.push(
    '-i', webm,
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', mp4
  );
  const r = spawnSync('ffmpeg', args, { stdio: 'pipe' });
  if (r.status !== 0) console.error('ffmpeg error:', r.stderr?.toString().slice(-300));
}

function dur(mp4) {
  return parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString()) || 0;
}

function frames(mp4, name, times) {
  for (const t of times) {
    spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `/tmp/fp-master/chk_${name}_t${t}.jpg`], { stdio: 'pipe' });
  }
}

// ── Master recorder ───────────────────────────────────────────────────────────
async function record(name, destFile, hash, scenarioFn) {
  const outDir = join(TMP_ROOT, name);
  mkdirSync(outDir, { recursive: true });
  const tok = await getToken();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(t => {
    try { sessionStorage.setItem('fp_session_token', t); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, tok);
  const page = await ctx.newPage();
  let skipMs = 0;
  try {
    skipMs = await boot(page, hash);
    console.log(`  [${name}] booted in ${skipMs}ms (will trim)`);
    await scenarioFn(page);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }
  const files = readdirSync(outDir).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm for ' + name);
  const mp4 = join(outDir, `${name}.mp4`);
  toMp4(join(outDir, files[0]), mp4, skipMs);
  const d = dur(mp4);
  spawnSync('cp', [mp4, join(DEST, `${destFile}.mp4`)]);
  frames(mp4, name, [1, Math.floor(d / 3), Math.floor(2 * d / 3), Math.max(1, Math.floor(d) - 2)]);
  console.log(`✓ ${destFile}.mp4  ${d.toFixed(1)}s`);
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// VIDEO 2 — Créer & Agir : Audits → Mission → Monitor → CWV
// ════════════════════════════════════════════════════════════════════════════
async function v2(page) {
  // Already on audits (booted there). Hover existing audit cards.
  await hov(page, '.fp-audit-card,.fp-card[data-id],table tbody tr', 3, 350);
  await sc(page, 80, 400);
  await hov(page, '.fp-audit-card,.fp-card[data-id],table tbody tr', 2, 300);
  await sc(page, -80, 380);
  await page.waitForTimeout(300);

  // Open first audit detail
  const opened = await cl(page, '.fp-audit-card,.fp-card[data-id],table tbody tr', 1000, 400);
  if (!opened) {
    // Fallback: click the audit list row
    await cl(page, 'table tbody tr:first-child,.fp-list-item:first-child', 1000, 400);
  }
  // Hover recommendations if visible
  await hov(page, '.fp-rec-item,.recommendation-item,.fp-issue-item', 2, 380);
  await sc(page, 100, 450);
  await page.waitForTimeout(300);
  await sc(page, -100, 380);
  // Close detail / go back
  await cl(page, 'button:has-text("← Retour"),button:has-text("Fermer"),.fp-back-btn', 500, 320);
  await page.waitForTimeout(600);

  // Create a mission from audits
  await cl(page, '#mission-new-btn,button:has-text("+ Mission"),button:has-text("Nouvelle mission"),button:has-text("Créer une mission")', 700, 380);
  const missionFilled = await fi(page, 'input[placeholder*="Titre"],input[placeholder*="titre"],input[id*="mission-title"],input[name*="title"]', 'Optimiser les balises meta des pages produit');
  if (!missionFilled) {
    await fi(page, 'input[type="text"]:visible', 'Optimiser les balises meta des pages produit');
  }
  await page.waitForTimeout(280);
  // Optionally fill priority/desc if visible
  await cl(page, 'select[name*="priority"],[id*="priority"]', 300, 260).catch(() => {});
  await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1400, 340);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await inj(page);

  // Navigate to Missions to show the created mission
  await nav(page, 'missions');
  await hov(page, 'table tbody tr,.mission-item,.fp-mission-card', 2, 340);
  await page.waitForTimeout(400);

  // Navigate to Monitors
  await nav(page, 'monitors');
  await page.waitForTimeout(500);
  await hov(page, '.fp-monitor-card,.monitor-row,.fp-card', 2, 320);

  // Create a new monitor
  await cl(page, '#monitor-new-btn,button:has-text("+ Monitor"),button:has-text("Nouveau monitor"),button:has-text("Ajouter")', 700, 380);
  await fi(page, 'input[placeholder*="https"],input[placeholder*="URL"],input[name*="url"],input[type="url"]', 'https://example.com/contact');
  await page.waitForTimeout(220);
  await fi(page, 'input[placeholder*="nom"],input[placeholder*="Nom"],input[name*="name"]', 'Monitor Contact QA').catch(() => {});
  await page.waitForTimeout(180);
  await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1400, 340);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await inj(page);
  await hov(page, '.fp-monitor-card,.monitor-row,.fp-card', 2, 320);

  // Core Web Vitals
  await nav(page, 'monitors');
  await page.waitForTimeout(400);
  // try to click CWV tab
  await cl(page, 'button:has-text("Core Web"),a:has-text("Core Web")', 800, 340);
  await page.waitForTimeout(600);
  await cl(page, 'button:has-text("+ URL"),button:has-text("Ajouter URL"),button:has-text("Nouvelle URL")', 700, 360);
  await fi(page, 'input[placeholder*="https"],input[type="url"]', 'https://example.com/');
  await page.waitForTimeout(180);
  await cl(page, 'button:has-text("Analyser"),button:has-text("Ajouter"),button[type="submit"]', 1200, 340);
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  await inj(page);
  await hov(page, '.fp-cwv-item,.cwv-item,.fp-card', 2, 300);
  await page.waitForTimeout(300);
}

// ════════════════════════════════════════════════════════════════════════════
// VIDEO 3 — Monitoring : Détail monitor → uptime → latence → incidents → alertes
// ════════════════════════════════════════════════════════════════════════════
async function v3(page) {
  // Already on monitors. Hover cards.
  await hov(page, '.fp-monitor-card,.monitor-row,.fp-card', 3, 340);
  await page.waitForTimeout(300);

  // Open first monitor detail
  await cl(page, '.fp-monitor-card,.monitor-row', 1000, 400);
  await page.waitForTimeout(500);

  // Hover uptime badge
  await hov(page, '.fp-uptime,.uptime-badge,.fp-stat', 2, 320);
  await sc(page, 120, 480);
  await page.waitForTimeout(350);

  // Hover latency chart area
  await go(page, 720, 440, 350);
  await page.waitForTimeout(320);
  await go(page, 820, 420, 280);
  await page.waitForTimeout(280);
  await go(page, 640, 460, 300);
  await page.waitForTimeout(300);

  // Hover incident list
  await hov(page, '.fp-incident-item,.incident-row', 2, 360);
  await sc(page, 80, 380);
  await page.waitForTimeout(300);

  // Click on an incident if available
  await cl(page, '.fp-incident-item,.incident-row', 700, 380);
  await page.waitForTimeout(400);
  await cl(page, 'button:has-text("Fermer"),button:has-text("←"),.fp-back-btn', 400, 300).catch(() => {});
  await page.waitForTimeout(400);
  await sc(page, -80, 350);

  // Switch to a different monitor
  await cl(page, 'button:has-text("← Retour"),button:has-text("Retour"),.fp-back-btn', 400, 300).catch(() => {});
  await page.waitForTimeout(600);
  // Hover second monitor
  const monitors = page.locator('.fp-monitor-card,.monitor-row,.fp-card');
  const cnt = await monitors.count().catch(() => 0);
  if (cnt > 1) {
    const b = await monitors.nth(1).boundingBox().catch(() => null);
    if (b && b.x > 155 && b.y > 52) {
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 360);
      await page.waitForTimeout(280);
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(900);
      await inj(page);
    }
  }
  await hov(page, '.fp-stat,.fp-kpi,.fp-metric', 3, 300);
  await sc(page, 100, 400);
  await page.waitForTimeout(300);

  // Navigate to Alertes
  await nav(page, 'monitors');
  await page.waitForTimeout(300);
  // Click alertes tab/section
  const alertNavOk = await cl(page, 'button:has-text("Alertes"),a:has-text("Alertes"),[data-route="alertes"]', 800, 340);
  if (!alertNavOk) await nav(page, 'monitors'); // fallback stay on monitors
  await page.waitForTimeout(500);
  await hov(page, '.fp-alert-item,.alert-row,.fp-card', 3, 330);
  // Open an alert
  await cl(page, '.fp-alert-item,.alert-row', 700, 360);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(350);
  await inj(page);
  await hov(page, '.fp-alert-item,.alert-row,.fp-card', 2, 300);
  await page.waitForTimeout(300);
}

// ════════════════════════════════════════════════════════════════════════════
// VIDEO 4 — Local SEO / Google Maps / Concurrents
// ════════════════════════════════════════════════════════════════════════════
async function v4(page) {
  // Already on local-seo. Hover ranking/position data.
  await hov(page, '.fp-kw-row,.fp-ranking-row,.fp-keyword-item,table tbody tr', 3, 340);
  await sc(page, 100, 460);
  await page.waitForTimeout(300);
  await hov(page, '.fp-kw-row,.fp-ranking-row,table tbody tr', 2, 300);
  await sc(page, -100, 400);

  // Open a keyword / position detail
  await cl(page, '.fp-kw-row,.fp-ranking-row,table tbody tr', 800, 380);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  // Navigate to competitors map area (within local-seo)
  // Try clicking competitor / map tab
  await cl(page, 'button:has-text("Concurrents"),a:has-text("Concurrents"),button:has-text("Carte"),a:has-text("Carte")', 600, 340);
  await page.waitForTimeout(1200);
  await inj(page);

  // Interact with the competitor map: hover over the radius selector
  const radiusSel = await page.$('#fp-comp-radius').catch(() => null);
  if (radiusSel) {
    const b = await radiusSel.boundingBox().catch(() => null);
    if (b && b.x > 155) {
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 340);
      await page.waitForTimeout(300);
      await page.selectOption('#fp-comp-radius', '10000').catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  // Hover competitor list
  await hov(page, '.fp-competitor-card,.competitor-row,.fp-card', 3, 340);

  // Open a competitor detail
  await cl(page, '.fp-competitor-card,.competitor-row', 900, 380);
  await page.waitForTimeout(400);
  await hov(page, '.fp-stat,.fp-metric,.fp-score', 2, 300);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  // Interact with keyword input
  const kwInput = await page.$('#fp-comp-keyword').catch(() => null);
  if (kwInput) {
    const b = await kwInput.boundingBox().catch(() => null);
    if (b && b.x > 155) {
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 340);
      await kwInput.click(); await page.waitForTimeout(200);
      await kwInput.fill('Restaurant'); await page.waitForTimeout(280);
      // Click Analyser
      await cl(page, 'button:has-text("Analyser"),button:has-text("🔍")', 800, 340);
      await page.waitForTimeout(1200);
    }
  }
  await inj(page);
  await hov(page, '.fp-competitor-card,.competitor-row,.fp-card', 2, 300);
  await sc(page, 80, 380);
  await page.waitForTimeout(350);
  await sc(page, -80, 350);
  await hov(page, '.fp-kw-row,.fp-ranking-row,table tbody tr', 2, 300);
  await page.waitForTimeout(300);
}

// ════════════════════════════════════════════════════════════════════════════
// VIDEO 5 — Assistant IA + Rapports
// ════════════════════════════════════════════════════════════════════════════
async function v5(page) {
  // Already on AI page. Click the input and type a question.
  await page.waitForTimeout(500);
  await hov(page, '.fp-prompt-card,.fp-ai-quick,button[data-ai-prompt]', 2, 300);
  await page.waitForTimeout(300);

  // Click the main AI input
  const aiInput = page.locator('#ai-input,.fp-ai-input').first();
  const inputOk = await aiInput.isVisible({ timeout: 4000 }).catch(() => false);
  if (inputOk) {
    const b = await aiInput.boundingBox().catch(() => null);
    if (b && b.x > 155 && b.y > 52) {
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 360);
      await aiInput.click(); await page.waitForTimeout(250);
      await aiInput.fill('Quelles sont mes priorités SEO cette semaine ?');
      await page.waitForTimeout(280);
      // Send
      await cl(page, '#ai-send,.fp-ai-send,button[type="submit"]', 300, 280);
      // Wait up to 18s for the first AI token (streaming)
      await page.waitForFunction(
        () => {
          const msgs = document.querySelectorAll('.fp-ai-msg-content,.ai-response,.fp-msg-bubble');
          return msgs.length > 0 && msgs[msgs.length - 1].textContent.length > 30;
        },
        { timeout: 18000, polling: 400 }
      ).catch(() => {});
      await page.waitForTimeout(1500);
      await inj(page);

      // Scroll to see the response
      await sc(page, 100, 450);
      await page.waitForTimeout(600);
      await hov(page, '.fp-ai-msg-content,.ai-response', 1, 400);
      await sc(page, 80, 380);
      await page.waitForTimeout(300);
    }
  }

  // Hover prompt library
  await hov(page, '.fp-prompt-card,.fp-card', 3, 300);
  await page.waitForTimeout(300);

  // Navigate to Rapports
  await nav(page, 'reports');
  await page.waitForTimeout(600);
  await hov(page, '.fp-report-type,.report-card,.fp-card', 3, 340);

  // Click a report type or "Générer"
  const genOk = await cl(page, 'button:has-text("Générer"),button:has-text("Nouveau rapport"),button:has-text("+ Rapport")', 1000, 380);
  if (genOk) {
    await hov(page, '.fp-report-option,.report-type-card,.fp-card', 2, 340);
    await cl(page, 'button:has-text("Générer"),button:has-text("Créer"),button[type="submit"]', 1200, 340);
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(400);
  await inj(page);
  await hov(page, '.fp-report-card,.report-item,.fp-card', 2, 320);
  await sc(page, 80, 380);
  await page.waitForTimeout(300);
  await sc(page, -80, 350);
  await page.waitForTimeout(300);
}

// ════════════════════════════════════════════════════════════════════════════
// VIDEO 6 — Quotidien : Missions → Activité → Notifs → Messages → Overview
// ════════════════════════════════════════════════════════════════════════════
async function v6(page) {
  // Already on missions. Hover mission cards/rows.
  await hov(page, 'table tbody tr,.mission-item,.fp-mission-card,.fp-card', 3, 340);
  await page.waitForTimeout(300);

  // Open a mission
  await cl(page, 'table tbody tr,.mission-item,.fp-mission-card', 1000, 400);
  await page.waitForTimeout(500);
  await hov(page, '.fp-mission-detail,.fp-stat,.fp-badge', 2, 300);
  // Change status if available
  await cl(page, 'select[name*="status"],[id*="status"],button:has-text("En cours"),button:has-text("Terminé")', 500, 300).catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await inj(page);

  // Stat overview blocks
  for (const [x, y] of [[250, 165], [470, 165], [690, 165], [910, 165]]) {
    if (y > 52 && x > 155) { await go(page, x, y, 300); await page.waitForTimeout(250); }
  }

  // Activity panel
  const actOk = await cl(page, '#fp-activity-btn,button[title*="Activit"],button[aria-label*="Activit"]', 900, 380);
  if (actOk) {
    await hov(page, '.fp-activity-item,.activity-item', 3, 300);
    await sc(page, 60, 340); await page.waitForTimeout(250);
    await sc(page, -60, 300);
    await page.mouse.click(400, 450); await page.waitForTimeout(400);
    await inj(page);
  }

  // Notifications panel
  const notifOk = await cl(page, '#fp-notif-btn,button[title*="Notif"],button[aria-label*="Notif"]', 900, 380);
  if (notifOk) {
    await hov(page, '#fp-notif-dropdown .fp-notif-item,.notification-item', 3, 300);
    await cl(page, '#fp-notif-dropdown .fp-notif-item,.notification-item', 500, 300);
    await page.waitForTimeout(300);
    await page.mouse.click(400, 500); await page.waitForTimeout(400);
    await inj(page);
  }

  // Messages panel
  const msgOk = await cl(page, '#fp-msg-btn,button[title*="Message"],button[aria-label*="Message"]', 900, 380);
  if (msgOk) {
    await cl(page, '#fp-msg-dropdown .fp-channel-btn,.fp-msg-channel-btn', 500, 300);
    await fi(page, '#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]', 'Rapport SEO prêt pour le client 👍');
    await page.waitForTimeout(200);
    await cl(page, '#fp-msg-send,button[aria-label*="Envoyer"]', 500, 270);
    await page.waitForTimeout(300);
    await page.mouse.click(400, 500); await page.waitForTimeout(400);
    await inj(page);
  }

  // Navigate to Overview and show KPIs
  await nav(page, 'overview');
  await page.waitForTimeout(600);
  for (const [x, y] of [[280, 200], [520, 200], [760, 200], [1000, 200]]) {
    if (y > 52 && x > 155) { await go(page, x, y, 300); await page.waitForTimeout(250); }
  }
  await hov(page, '.fp-kpi-card,.kpi-card,.fp-stat-card,.fp-stat', 3, 300);
  await sc(page, 120, 480); await page.waitForTimeout(350);
  await hov(page, '.fp-card,.fp-section-card', 2, 280);
  await sc(page, -120, 440); await page.waitForTimeout(400);
}

// ════════════════════════════════════════════════════════════════════════════
// RUN ALL VIDEOS
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════');
console.log(' FlowPoint — Recording V2–V6');
console.log('═══════════════════════════════════\n');

const results = [];

try {
  console.log('▶ VIDEO 2 — Créer & Agir (audits → mission → monitor → CWV)');
  const d2 = await record('v2', 'step2-audit-actions', 'audits', v2);
  results.push({ v: 2, dur: d2, ok: d2 > 10 });
} catch (e) { console.error('V2 ERROR:', e.message); results.push({ v: 2, dur: 0, ok: false }); }

try {
  console.log('\n▶ VIDEO 3 — Monitoring (détail → uptime → latence → incidents → alertes)');
  const d3 = await record('v3', 'step3-monitoring-alerts', 'monitors', v3);
  results.push({ v: 3, dur: d3, ok: d3 > 10 });
} catch (e) { console.error('V3 ERROR:', e.message); results.push({ v: 3, dur: 0, ok: false }); }

try {
  console.log('\n▶ VIDEO 4 — Local SEO / Google Maps / Concurrents');
  const d4 = await record('v4', 'step4-local-competition', 'local-seo', v4);
  results.push({ v: 4, dur: d4, ok: d4 > 10 });
} catch (e) { console.error('V4 ERROR:', e.message); results.push({ v: 4, dur: 0, ok: false }); }

try {
  console.log('\n▶ VIDEO 5 — Assistant IA + Rapports');
  const d5 = await record('v5', 'step5-ai-reports', 'ai', v5);
  results.push({ v: 5, dur: d5, ok: d5 > 10 });
} catch (e) { console.error('V5 ERROR:', e.message); results.push({ v: 5, dur: 0, ok: false }); }

try {
  console.log('\n▶ VIDEO 6 — Quotidien (missions → activité → notifs → messages → overview)');
  const d6 = await record('v6', 'step6-daily', 'missions', v6);
  results.push({ v: 6, dur: d6, ok: d6 > 10 });
} catch (e) { console.error('V6 ERROR:', e.message); results.push({ v: 6, dur: 0, ok: false }); }

console.log('\n═══════════════════════════════════');
console.log(' RÉSULTATS');
console.log('═══════════════════════════════════');
for (const r of results) {
  console.log(`  V${r.v}: ${r.ok ? '✓' : '✗'} ${r.dur.toFixed(1)}s`);
}
const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length} vidéo(s) en erreur: V${failed.map(r => r.v).join(', V')}`);
  process.exit(1);
}
console.log('\nTous done.');
