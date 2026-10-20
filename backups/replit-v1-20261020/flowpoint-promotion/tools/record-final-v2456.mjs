/**
 * FlowPoint — Final V2, V4, V5, V6 (short, focused, correct selectors)
 *
 * Target durations: V2 ≤35s, V4 ≤28s, V5 ≤38s, V6 ≤28s
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE   = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const DEST   = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const TMP    = '/tmp/fp-final';
mkdirSync(TMP, { recursive: true });

async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error('token: ' + JSON.stringify(d));
  return d.token;
}

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function inj(p) {
  await p.evaluate(s => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div'); w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s; document.body.appendChild(w);
    let cx = 660, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left = cx + 'px'; w.style.top = cy + 'px'; }, { passive: true });
    window._cx = cx; window._cy = cy;
  }, CSR);
}

async function go(p, tx, ty, ms = 380) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 660, y: window._cy || 360 }));
  const n = Math.max(12, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e));
    await p.waitForTimeout(14);
  }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}

async function sc(p, d, ms = 380) {
  const n = Math.max(5, Math.round(ms / 30));
  for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); }
  await p.waitForTimeout(80);
}

async function cl(p, sel, ams = 500, mms = 320) {
  try {
    const el = p.locator(sel).first();
    if (!await el.isVisible({ timeout: 3000 }).catch(() => false)) return false;
    const b = await el.boundingBox();
    if (!b || b.x < 155 || b.y < 56) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms);
    await p.waitForTimeout(60);
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(ams); await inj(p); return true;
  } catch { return false; }
}

async function fi(p, sel, text) {
  try {
    const el = p.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 4000 });
    const b = await el.boundingBox(); if (!b || b.x < 155) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 260);
    await el.click(); await p.waitForTimeout(140); await el.fill(text); await p.waitForTimeout(160);
    return true;
  } catch { return false; }
}

async function hov(p, sel, max = 3, dw = 280) {
  const it = p.locator(sel);
  const n = Math.min(await it.count().catch(() => 0), max);
  for (let i = 0; i < n; i++) {
    const b = await it.nth(i).boundingBox().catch(() => null);
    if (b && b.x > 155 && b.y > 56 && b.width > 40) { await go(p, b.x + b.width / 2, b.y + b.height / 2, 320); await p.waitForTimeout(dw); }
  }
}

async function boot(p, hash) {
  const t0 = Date.now();
  await p.goto(`${BASE}/dashboard.html#${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try { await p.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 26000, polling: 300 }); }
  catch { await p.waitForSelector('.fp-card,h1', { timeout: 8000 }).catch(() => {}); }
  await p.waitForTimeout(2200);
  for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")']) {
    try { const b = p.locator(s).first(); if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click(); await p.waitForTimeout(350); break; } } catch {}
  }
  const h = await p.evaluate(() => window.location.hash.replace('#', ''));
  if (h !== hash) { await p.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash = r; }, hash); await p.waitForTimeout(2000); }
  await p.mouse.move(660, 360); await p.evaluate(() => { window._cx = 660; window._cy = 360; }); await inj(p);
  return Date.now() - t0;
}

function toMp4(webm, mp4, skipMs = 0) {
  const ss = Math.max(0, (skipMs - 500) / 1000);
  const args = ['-y'];
  if (ss > 0.3) args.push('-ss', ss.toFixed(2));
  args.push('-i', webm, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
  spawnSync('ffmpeg', args, { stdio: 'pipe' });
}

function dur(mp4) { return parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString()) || 0; }

function frames(mp4, name, times) {
  for (const t of times) spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `${TMP}/fn_${name}_t${t}.jpg`], { stdio: 'pipe' });
}

async function record(name, destFile, hash, fn) {
  const outDir = join(TMP, name); mkdirSync(outDir, { recursive: true });
  const tok = await getToken();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(t => { try { sessionStorage.setItem('fp_session_token', t); } catch {} Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); }, tok);
  const p = await ctx.newPage();
  let skipMs = 0;
  try { skipMs = await boot(p, hash); console.log(`  [${name}] boot ${skipMs}ms`); await fn(p); }
  finally { await p.close(); await ctx.close(); await browser.close(); }
  const files = readdirSync(outDir).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm: ' + name);
  const mp4 = join(outDir, `${name}.mp4`);
  toMp4(join(outDir, files[0]), mp4, skipMs);
  const d = dur(mp4);
  spawnSync('cp', [mp4, join(DEST, `${destFile}.mp4`)]);
  frames(mp4, name, [1, Math.floor(d / 3), Math.floor(2 * d / 3), Math.max(1, Math.floor(d) - 2)]);
  console.log(`✓ ${destFile}.mp4  ${d.toFixed(1)}s`);
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// V2 — Monitors with real data + create mission + create monitor (≤35s target)
// ════════════════════════════════════════════════════════════════════════════
async function v2(p) {
  // Monitors overview — hover cards (real data: DOWN monitors)
  await hov(p, '.fp-monitor-card,.monitor-row', 3, 320);
  await sc(p, 80, 360);
  await hov(p, '.fp-monitor-card,.monitor-row', 2, 280);
  await sc(p, -80, 340);

  // Open first monitor detail panel (click on a card)
  const cards = p.locator('.fp-monitor-card,.monitor-row');
  const cnt = await cards.count().catch(() => 0);
  if (cnt > 0) {
    const b = await cards.first().boundingBox().catch(() => null);
    if (b && b.x > 155 && b.y > 56) {
      await go(p, b.x + b.width / 2, b.y + b.height / 2, 360);
      await p.waitForTimeout(60);
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await p.waitForTimeout(800); await inj(p);
      // Hover detail stats
      await hov(p, '.fp-stat,.fp-uptime,.fp-metric,.fp-badge', 2, 280);
      await sc(p, 80, 360); await p.waitForTimeout(280); await sc(p, -80, 330);
      // Close
      await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(400); await inj(p);
    }
  }

  // Performance tab — hover it
  const perfOk = await cl(p, '[role="tab"]:has-text("Performance"),button:has-text("Performance")', 600, 320);
  if (perfOk) { await hov(p, '.fp-chart,.recharts-wrapper,.fp-perf', 1, 380); await p.waitForTimeout(300); }

  // Incidents tab
  await cl(p, '[role="tab"]:has-text("Incidents"),button:has-text("Incidents")', 600, 320);
  await hov(p, '.fp-incident-row,.fp-incident-item', 2, 300);

  // Back to Status
  await cl(p, '[role="tab"]:has-text("Status"),button:has-text("Status")', 400, 280);
  await p.waitForTimeout(300);

  // CREATE MONITOR — click "+ Nouveau" button
  const newMonOk = await cl(p, '#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau"),button:has-text("+ Monitor")', 700, 360);
  if (newMonOk) {
    await fi(p, 'input[placeholder*="https"],input[type="url"],input[name*="url"]', 'https://example.com/services');
    await p.waitForTimeout(180);
    await cl(p, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1100, 320);
    await p.waitForTimeout(380); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(400); await inj(p);
  }

  // Navigate to missions via window.navigate
  await p.evaluate(() => { if (window.navigate) window.navigate('missions'); else window.location.hash = 'missions'; });
  await p.waitForTimeout(1800); await inj(p);
  await hov(p, 'table tbody tr,.mission-item,.fp-mission-card', 2, 300);

  // CREATE MISSION
  const newMOk = await cl(p, '#mission-new-btn,button:has-text("+ Mission"),button:has-text("Nouvelle mission"),button:has-text("Créer une mission")', 650, 360);
  if (newMOk) {
    await fi(p, 'input[placeholder*="Titre"],input[placeholder*="titre"],input[name="title"]', 'Optimiser les images produit');
    await p.waitForTimeout(220);
    await cl(p, 'button:has-text("Créer la mission"),button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1100, 320);
    await p.waitForTimeout(350); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(380); await inj(p);
  }
  await hov(p, 'table tbody tr,.mission-item,.fp-mission-card', 2, 280);
  await p.waitForTimeout(350);
}

// ════════════════════════════════════════════════════════════════════════════
// V4 — Local SEO: Aperçu (hover KPIs, CTA buttons), scroll, Local SEO real sections
// Strategy: do NOT click tabs (they redirect to overview), interact with what IS visible
// ════════════════════════════════════════════════════════════════════════════
async function v4(p) {
  // Hover CTA buttons at top (safe zone, real buttons)
  await hov(p, 'button.fp-btn,.fp-btn-primary,button:has-text("Rapport"),button:has-text("Mission"),a.fp-btn', 3, 320);
  await p.waitForTimeout(300);

  // Hover KPI blocks (score domination, zones, opportunités, menaces)
  for (const [x, y] of [[200, 160], [375, 160], [560, 160], [745, 160]]) {
    await go(p, x, y, 290); await p.waitForTimeout(260);
  }

  // Scroll to see Google Maps section below
  await sc(p, 150, 460); await p.waitForTimeout(380);
  await go(p, 660, 400, 300); await p.waitForTimeout(300);
  await go(p, 800, 380, 280); await p.waitForTimeout(280);
  await go(p, 640, 450, 280); await p.waitForTimeout(280);

  // Scroll back up
  await sc(p, -80, 340); await p.waitForTimeout(300);

  // Click "Générer pages locales" button if visible
  await cl(p, 'button:has-text("Générer pages"),button:has-text("Rapport stratégique"),button:has-text("Voir les opportunités")', 700, 340);
  await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(350); await inj(p);

  // Click "Mission locale" button
  await cl(p, 'button:has-text("Mission locale"),button:has-text("+ Mission")', 700, 340);
  await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(350); await inj(p);

  // Navigate to competitors section directly (avoid tab click that redirects)
  // Use window.navigate with a sub-route if available
  await p.evaluate(() => {
    if (window.navigate) window.navigate('local-seo');
    else window.location.hash = 'local-seo';
  });
  await p.waitForTimeout(1800); await inj(p);

  // Try GBP tab (Avis IA might have content)
  // Instead of clicking tabs, interact with visible content
  await sc(p, 120, 440); await p.waitForTimeout(340);
  await go(p, 700, 380, 300); await p.waitForTimeout(300);
  await go(p, 840, 360, 280); await p.waitForTimeout(280);
  await go(p, 600, 420, 270); await p.waitForTimeout(260);
  await sc(p, 100, 400); await p.waitForTimeout(300);
  await go(p, 720, 440, 280); await p.waitForTimeout(280);
  await sc(p, -200, 440); await p.waitForTimeout(350);

  // Hover action buttons at top
  await hov(p, 'button.fp-btn,.fp-btn-primary,a.fp-btn-primary', 2, 300);
  await p.waitForTimeout(350);
}

// ════════════════════════════════════════════════════════════════════════════
// V5 — AI: direct textarea fill via evaluate + wait for response + Rapports
// ════════════════════════════════════════════════════════════════════════════
async function v5(p) {
  // AI page loaded. Show prompt chips briefly.
  await hov(p, '.fp-ai-suggestion,.fp-quick-prompt,.fp-prompt-chip', 3, 280);
  await p.waitForTimeout(300);

  // Fill AI textarea directly using page.evaluate — more reliable than selector
  const typed = await p.evaluate(async () => {
    // Find the AI input textarea
    const candidates = [
      document.querySelector('#ai-input'),
      document.querySelector('textarea.fp-ai-input'),
      document.querySelector('textarea[placeholder]'),
      document.querySelector('.fp-chat-input textarea'),
      document.querySelector('textarea'),
    ].filter(Boolean);
    const ta = candidates[0];
    if (!ta) return false;
    ta.focus();
    // Use InputEvent to set value and trigger React/Vue listeners
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) nativeInputValueSetter.call(ta, 'Quelles sont mes priorités SEO cette semaine ?');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });

  if (typed) {
    // Move cursor to textarea location
    const taEl = p.locator('#ai-input,textarea.fp-ai-input,textarea').first();
    const taB = await taEl.boundingBox().catch(() => null);
    if (taB && taB.x > 155 && taB.y > 56) {
      await go(p, taB.x + taB.width / 2, taB.y + taB.height / 2, 320);
      await p.waitForTimeout(300);
    }

    // Send via button or Enter
    const sendOk = await cl(p, '#ai-send,button[aria-label*="Envoyer"],button[type="submit"].fp-ai-send', 300, 280);
    if (!sendOk) {
      // Try Enter key after focusing the textarea
      await p.evaluate(() => {
        const ta = document.querySelector('#ai-input,textarea.fp-ai-input,textarea');
        if (ta) { ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); }
      });
      await p.waitForTimeout(300);
    }
    await inj(p);

    // Wait for AI response
    try {
      await p.waitForFunction(() => {
        const msgs = document.querySelectorAll('.fp-ai-msg,.fp-ai-response,.fp-chat-msg,.fp-msg-bubble');
        const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        return last && last.textContent && last.textContent.length > 25;
      }, { timeout: 22000, polling: 400 });
      await p.waitForTimeout(1500); await inj(p);
      await sc(p, 100, 420); await p.waitForTimeout(400);
      await hov(p, '.fp-ai-msg,.fp-ai-response,.fp-chat-msg', 1, 400);
      await sc(p, 60, 360); await p.waitForTimeout(300);
    } catch {
      await p.waitForTimeout(1000); await inj(p);
    }
  } else {
    // AI input not found — show the AI page content and hover elements
    await hov(p, '.fp-card,.fp-ai-card', 3, 300);
    await sc(p, 100, 420); await p.waitForTimeout(400);
  }

  // Show AI tabs: Intelligence, Actions Rapides
  await cl(p, '[role="tab"]:has-text("Intelligence"),button:has-text("Intelligence")', 600, 320);
  await p.waitForTimeout(300);
  await hov(p, '.fp-card,.fp-intelligence-card', 2, 280);
  await p.waitForTimeout(300);

  // Navigate to Rapports
  await p.evaluate(() => { if (window.navigate) window.navigate('reports'); else window.location.hash = 'reports'; });
  await p.waitForTimeout(1800); await inj(p);
  await hov(p, '.fp-report-type,.report-card,.fp-card', 3, 320);

  // Click a report card to show it
  const rOk = await cl(p, '.fp-report-type,.report-card', 700, 360);
  if (!rOk) await cl(p, 'button:has-text("Nouveau"),button:has-text("+ Nouveau")', 700, 360);
  await p.waitForTimeout(400);
  await hov(p, '.fp-report-type,.report-card,.fp-card', 2, 280);
  await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(300); await inj(p);
  await sc(p, 80, 360); await p.waitForTimeout(280); await sc(p, -80, 340); await p.waitForTimeout(300);
}

// ════════════════════════════════════════════════════════════════════════════
// V6 — Missions (real data), open, create, overview KPIs (≤28s target)
// ════════════════════════════════════════════════════════════════════════════
async function v6(p) {
  // Missions with 3 actives (real data from frame checks)
  await hov(p, 'table tbody tr,.mission-item,.fp-mission-card', 3, 320);
  await p.waitForTimeout(300);

  // Open first mission detail
  const rows = p.locator('table tbody tr,.mission-item,.fp-mission-card');
  const cnt = await rows.count().catch(() => 0);
  if (cnt > 0) {
    const b = await rows.first().boundingBox().catch(() => null);
    if (b && b.x > 155 && b.y > 56) {
      await go(p, b.x + b.width / 2, b.y + b.height / 2, 360);
      await p.waitForTimeout(60);
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await p.waitForTimeout(900); await inj(p);
      await hov(p, '.fp-badge,.fp-priority,.fp-status-badge,.fp-tag', 2, 260);
      await sc(p, 70, 340); await p.waitForTimeout(260); await sc(p, -70, 310);
      await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(400); await inj(p);
    }
  }

  // Hover more mission rows
  await hov(p, 'table tbody tr,.mission-item', 2, 280);

  // Create new mission
  const newM = await cl(p, '#mission-new-btn,button:has-text("+ Mission"),button:has-text("Créer une mission"),button:has-text("Nouvelle")', 650, 360);
  if (newM) {
    await fi(p, 'input[placeholder*="Titre"],input[placeholder*="titre"],input[name="title"]', 'Améliorer vitesse page produit');
    await p.waitForTimeout(220);
    await cl(p, 'button:has-text("Créer la mission"),button:has-text("Créer"),button[type="submit"]', 1000, 320);
    await p.waitForTimeout(350); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(380); await inj(p);
  }

  // Stat blocks at y≥230 (not y=165 which hits sidebar)
  for (const [x, y] of [[265, 235], [485, 235], [710, 235], [935, 235]]) {
    await go(p, x, y, 270); await p.waitForTimeout(220);
  }

  // Switch to Kanban view if available
  await cl(p, '[role="tab"]:has-text("Kanban"),button:has-text("Kanban")', 500, 280);
  await hov(p, '.fp-kanban-col,.fp-kanban-card,.fp-card', 2, 260);
  await p.waitForTimeout(300);
  await cl(p, '[role="tab"]:has-text("Toutes"),button:has-text("Toutes")', 400, 260);
  await hov(p, 'table tbody tr,.mission-item', 2, 260);
  await p.waitForTimeout(350);
}

// ════════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════════
const results = [];

console.log('▶ V2 — Monitors + missions (target ≤35s)');
try { const d = await record('v2f', 'step2-audit-actions', 'monitors', v2); results.push({ v: 2, d, ok: d >= 15 && d <= 50 }); }
catch (e) { console.error('V2:', e.message); results.push({ v: 2, d: 0, ok: false }); }

console.log('\n▶ V4 — Local SEO aperçu exploration (target ≤28s)');
try { const d = await record('v4f', 'step4-local-competition', 'local-seo', v4); results.push({ v: 4, d, ok: d >= 18 && d <= 40 }); }
catch (e) { console.error('V4:', e.message); results.push({ v: 4, d: 0, ok: false }); }

console.log('\n▶ V5 — AI (direct fill) + Rapports (target ≤38s)');
try { const d = await record('v5f', 'step5-ai-reports', 'ai', v5); results.push({ v: 5, d, ok: d >= 20 && d <= 55 }); }
catch (e) { console.error('V5:', e.message); results.push({ v: 5, d: 0, ok: false }); }

console.log('\n▶ V6 — Missions quotidien (target ≤28s)');
try { const d = await record('v6f', 'step6-daily', 'missions', v6); results.push({ v: 6, d, ok: d >= 14 && d <= 40 }); }
catch (e) { console.error('V6:', e.message); results.push({ v: 6, d: 0, ok: false }); }

console.log('\n═══════════════════════════════════');
for (const r of results) console.log(`  V${r.v}: ${r.ok ? '✓' : '✗'} ${r.d.toFixed(1)}s`);
