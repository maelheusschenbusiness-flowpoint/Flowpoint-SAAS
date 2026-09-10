/**
 * FlowPoint Onboarding Video — V1 PILOT (1920×1080)
 * Scénario : "Comprendre FlowPoint en quelques secondes."
 *
 * Étapes :
 *  0. Fade in → Overview chargé
 *  1. Vue générale du dashboard (hover navigation)
 *  2. Hover KPI cards + zoom sur le score principal
 *  3. Scroll vers insights / opportunités
 *  4. Navigation vers Audits SEO
 *  5. Focus sur les résultats (zoom + callout)
 *  6. Retour Overview — vue globale
 *  7. Fade out
 *
 * Post-processing FFmpeg :
 *  - 1920×1080 H.264 CRF 18
 *  - Zooms fluides sur moments clés
 *  - Callouts style FlowPoint (bleu #2563eb, DejaVu Sans Bold)
 *  - Fade in/out
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = process.env.FLOWPOINT_RECORD_BASE || 'http://127.0.0.1:8081';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_DIR  = '/tmp/fp-v1pilot';
const DEST_DIR = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const FONT     = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1920, H = 1080;
mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 60 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error('Token: ' + JSON.stringify(d));
  return d.token;
}

async function seed() {
  const r = await fetch(`${BASE}/api/admin/demo-seed`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, clear: true }),
  });
  return r.json();
}

// Custom cursor SVG — smaller, cleaner
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M3 1.5 L3 16.5 L7 12.5 L10 19 L12.5 17.5 L9.5 11 L16.5 11 Z" fill="white" stroke="#111827" stroke-width="1.0" stroke-linejoin="round"/></svg>`;

async function injectCursor(page) {
  await page.evaluate(svg => {
    document.getElementById('_fpcur')?.remove();
    const w = document.createElement('div');
    w.id = '_fpcur';
    w.style.cssText = 'position:fixed;top:0;left:0;width:20px;height:20px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))';
    w.innerHTML = svg;
    document.body.appendChild(w);
    document.addEventListener('mousemove', e => {
      w.style.left = e.clientX + 'px';
      w.style.top  = e.clientY + 'px';
    }, { passive: true });
    document.addEventListener('mousedown', () => {
      w.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,.6)) brightness(.8)';
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${parseFloat(w.style.left)-10}px;top:${parseFloat(w.style.top)-10}px;width:20px;height:20px;border-radius:50%;border:2px solid rgba(37,99,235,.7);pointer-events:none;z-index:2147483646;animation:_cr .4s ease-out forwards`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 420);
    });
    document.addEventListener('mouseup', () => {
      w.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,.6))';
    });
    if (!document.getElementById('_crstyle')) {
      const s = document.createElement('style');
      s.id = '_crstyle';
      s.textContent = '@keyframes _cr{0%{transform:scale(.2);opacity:1}100%{transform:scale(2.2);opacity:0}}';
      document.head.appendChild(s);
    }
    window._cx = window.innerWidth / 2;
    window._cy = window.innerHeight / 2;
  }, CURSOR_SVG);
}

// Smooth eased movement — easeInOutQuad
async function go(page, tx, ty, ms = 500) {
  const { x, y } = await page.evaluate(() => ({ x: window._cx || W/2, y: window._cy || H/2 }));
  const steps = Math.max(20, Math.round(ms / 12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e));
    await page.waitForTimeout(12);
  }
  await page.evaluate(p => { window._cx = p.x; window._cy = p.y; }, { x: tx, y: ty });
}

// Smooth scroll
async function scroll(page, delta, ms = 600) {
  const steps = Math.max(10, Math.round(ms / 25));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta / steps);
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(100);
}

// Move cursor to a point and dwell
async function dwell(page, x, y, ms = 400, moveMs = 400) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(ms);
}

// Navigate via window.navigate
async function nav(page, route, waitSel = null) {
  await page.evaluate(r => {
    if (window.navigate) window.navigate(r);
    else window.location.hash = r;
  }, route);
  await page.waitForTimeout(1700);
  if (waitSel) await page.waitForSelector(waitSel, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(350);
  await injectCursor(page);
}

// ── Timing tracker ────────────────────────────────────────────────────────────
// Records elapsed seconds since recording started (after skip trim)
// Used to compute FFmpeg zoom/callout timestamps
const marks = {};
let _recordStart = 0;
let _skipMs = 0;

function mark(name, page) {
  const now = Date.now();
  const elapsed = (now - _recordStart - _skipMs) / 1000;
  marks[name] = Math.max(0, elapsed);
  console.log(`  ⏱  [${name}] t=${elapsed.toFixed(2)}s`);
}

// ── V1 Scenario ───────────────────────────────────────────────────────────────
async function v1(page, token) {
  // Boot
  const bootT0 = Date.now();
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction(
      () => typeof window.STATE !== 'undefined' && window.STATE.loading === false,
      { timeout: 25000, polling: 300 }
    );
  } catch {
    await page.waitForSelector('h1,h2', { timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(1000);

  // Dismiss onboarding modal if shown
  for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")', 'button:has-text("Skip")']) {
    try {
      const b = page.locator(s).first();
      if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
        await b.click();
        await page.waitForTimeout(400);
        break;
      }
    } catch {}
  }

  // Navigate to Overview
  await page.evaluate(() => {
    if (window.navigate) window.navigate('overview');
    else window.location.hash = 'overview';
  });
  await page.waitForTimeout(1800);
  await page.waitForSelector('h1,.fp-kpi-card,.kpi-card,.metric-card', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);

  // Position cursor at center, inject custom cursor
  await page.mouse.move(W / 2, H / 2);
  await page.evaluate(() => { window._cx = 960; window._cy = 540; });
  await injectCursor(page);
  await page.waitForTimeout(300);

  const skipMs = Date.now() - bootT0;
  _skipMs = skipMs;
  _recordStart = Date.now() - skipMs; // will be set properly in record()

  // ── STEP 1: Vue générale — hover sidebar items (without clicking) ─────────
  // Wait 1.2s on Overview so viewer sees the full dashboard
  await page.waitForTimeout(800);
  mark('overview_start');

  // Gentle hover along sidebar nav items (just movement, no click)
  await dwell(page, 120, 200, 100, 260); // sidebar item 1
  await dwell(page, 120, 248, 100, 220);
  await dwell(page, 120, 296, 100, 220);
  await dwell(page, 120, 344, 100, 220);
  // Move to main content area
  await go(page, 700, 300, 300);
  await page.waitForTimeout(250);
  mark('sidebar_done');

  // ── STEP 2: Hover KPI cards left to right ────────────────────────────────
  // Try to find actual KPI card positions; fall back to approximate coords
  const kpiPositions = await page.evaluate(() => {
    const cards = document.querySelectorAll('.fp-kpi-card,.kpi-card,.metric-card,[data-kpi]');
    if (cards.length === 0) return [];
    return [...cards].slice(0, 4).map(c => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
  });

  const kpiFallback = [
    { x: 340, y: 200 }, { x: 620, y: 200 }, { x: 900, y: 200 }, { x: 1180, y: 200 },
  ];
  const kpiTargets = kpiPositions.length >= 2 ? kpiPositions : kpiFallback;

  mark('kpi_hover_start');
  for (const { x, y } of kpiTargets.slice(0, 3)) {
    await dwell(page, x, y, 180, 300);
  }
  // Park cursor near score card (first or second KPI)
  const scorePos = kpiTargets[0] || { x: 340, y: 200 };
  await go(page, scorePos.x, scorePos.y, 280);
  await page.waitForTimeout(250);
  mark('kpi_score_focus');

  // Linger on score for viewer to read
  await page.waitForTimeout(850);
  mark('kpi_score_done');

  // ── STEP 3: Move to insights / priorities section ─────────────────────────
  await go(page, W / 2, H / 2, 300);
  await page.waitForTimeout(250);

  // Scroll down gently to reveal insights/opportunities
  await scroll(page, 220, 500);
  await page.waitForTimeout(200);

  // Find insights cards
  const insightPos = await page.evaluate(() => {
    const sel = '.fp-insight,.insight-card,.opportunity-card,.recommendation-card,[data-insight],[data-opportunity]';
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });

  if (insightPos) {
    await dwell(page, insightPos.x, insightPos.y, 220, 350);
  } else {
    // Fallback: hover middle of visible area
    await dwell(page, 800, 500, 220, 350);
    await dwell(page, 1100, 480, 180, 320);
  }
  mark('insights_done');

  // Hover a second insight item if available
  const insightPos2 = await page.evaluate(() => {
    const items = document.querySelectorAll('.fp-insight,.insight-card,.opportunity-card,.recommendation-card');
    if (items.length < 2) return null;
    const r = items[1].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  if (insightPos2 && insightPos2.y > 0 && insightPos2.y < H) {
    await dwell(page, insightPos2.x, insightPos2.y, 180, 300);
  }

  // Scroll back to top
  await scroll(page, -220, 450);
  await page.waitForTimeout(200);
  mark('scroll_top');

  // ── STEP 4: Navigate to Audits SEO ───────────────────────────────────────
  // Move cursor to sidebar Audits nav item (no click — use window.navigate)
  // First, hover the sidebar to make it visible
  await go(page, 120, 248, 300); // approximate Audits nav position
  await page.waitForTimeout(200);
  await injectCursor(page);

  // Navigate
  await nav(page, 'audits', 'table tbody tr,.audit-row,.audit-card');
  mark('audits_loaded');

  // ── STEP 5: Show Audits — hover stat blocks + table rows ─────────────────
  // Hover stat blocks
  const auditStats = await page.evaluate(() => {
    const cards = document.querySelectorAll('.fp-stat-card,.stat-card,[class*="stat-block"],[class*="summary-card"]');
    return [...cards].slice(0, 4).map(c => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
  });

  if (auditStats.length >= 2) {
    for (const { x, y } of auditStats.slice(0, 2)) {
      if (y > 0 && y < H) await dwell(page, x, y, 180, 280);
    }
  } else {
    for (const [x, y] of [[340, 175], [640, 175], [940, 175], [1240, 175]]) {
      await dwell(page, x, y, 200, 340);
    }
  }
  mark('audit_stats_done');

  // Hover table rows
  const auditRows = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr,.audit-row,.audit-card');
    return [...rows].slice(0, 3).map(r => {
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left + b.width * 0.4), y: Math.round(b.top + b.height / 2) };
    });
  });

  if (auditRows.length >= 1) {
    for (const { x, y } of auditRows) {
      if (x > 150 && y > 0 && y < H) await dwell(page, x, y, 180, 300);
    }
  } else {
      await dwell(page, 700, 320, 180, 320);
      await dwell(page, 700, 380, 170, 260);
      await dwell(page, 700, 440, 160, 240);
  }
  mark('audit_rows_done');

  // Linger — let viewer read
  await go(page, W * 0.55, H * 0.45, 300);
  await page.waitForTimeout(500);
  mark('audit_linger_done');

  // ── STEP 6: Return to Overview ────────────────────────────────────────────
  await go(page, 120, 200, 300); // hover Overview in sidebar
  await page.waitForTimeout(200);
  await nav(page, 'overview', 'h1,.fp-kpi-card,.kpi-card');
  mark('back_overview');

  // Final wide-shot dwell — slow pan across KPI cards
  for (const { x, y } of kpiTargets.slice(0, 3)) {
    await go(page, x, y, 300);
    await page.waitForTimeout(180);
  }
  await go(page, W * 0.6, H * 0.55, 300);
  await page.waitForTimeout(450);
  mark('final');

  return skipMs;
}

// ── Recorder ─────────────────────────────────────────────────────────────────
async function record(fn, token) {
  const tmp = join(OUT_DIR, 'raw');
  mkdirSync(tmp, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/repl/tools/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--allow-running-insecure-content',
      '--force-device-scale-factor=1',
    ],
  });

  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: tmp, size: { width: W, height: H } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
    deviceScaleFactor: 1,
  });

  await ctx.addInitScript(tok => {
    try { sessionStorage.setItem('fp_session_token', tok); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, token);

  const page = await ctx.newPage();
  _recordStart = Date.now();

  let skipMs = 0;
  try {
    skipMs = await fn(page, token);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }

  const files = readdirSync(tmp).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm produced');
  const webm = join(tmp, files[0]);
  console.log(`  Raw webm: ${webm}`);

  // Adjust marks: they are absolute elapsed since _recordStart
  // After trim, t=0 is at skipMs
  // marks already account for skipMs (we subtracted it in mark())
  const m = marks;
  writeFileSync(join(OUT_DIR, 'marks.json'), JSON.stringify({ skipMs, marks: m }, null, 2));
  console.log('  Marks:', JSON.stringify(m, null, 2));

  return { webm, skipMs };
}

// ── FFmpeg post-processing ────────────────────────────────────────────────────
function postProcess(webm, skipMs) {
  const m = marks;
  const ss = Math.max(0, (skipMs - 600) / 1000);
  const raw = join(OUT_DIR, 'trimmed.mp4');
  const out = join(OUT_DIR, 'v1-pilot-final.mp4');

  // Step 1: trim, scale to 1920×1080, 30fps → raw trimmed
  console.log(`  FFmpeg step 1: trim (ss=${ss.toFixed(2)}s) → ${W}×${H} 30fps`);
  let r = spawnSync('ffmpeg', [
    '-y',
    ...(ss > 0.3 ? ['-ss', ss.toFixed(2)] : []),
    '-i', webm,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    raw,
  ], { stdio: 'pipe' });
  if (r.status !== 0) {
    console.error('FFmpeg step 1 failed:', r.stderr?.toString().slice(-500));
    throw new Error('trim failed');
  }

  // Get duration of trimmed file
  const dur = parseFloat(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', raw], { stdio: 'pipe' }).stdout.toString().trim()
  );
  console.log(`  Trimmed duration: ${dur.toFixed(2)}s`);

  const fadeInDur  = 0.7;
  const fadeOutDur = 0.8;
  const fadeOutAt  = Math.max(0, dur - fadeOutDur);
  const totalFrames = Math.round(dur * 30);

  // Zoom events: [startT, endT, zoomLevel, cropXFrac, cropYFrac, label]
  // cropXFrac: 0=left, 0.5=center, 1=right anchor for crop offset
  // cropYFrac: 0=top, 0.5=center, 1=bottom
  const kpiStart = m.kpi_hover_start ?? 3.0;
  const kpiScoreStart = m.kpi_score_focus ?? 5.5;
  const kpiScoreDone  = m.kpi_score_done  ?? 7.5;
  const insightsDone  = m.insights_done   ?? 12.0;
  const auditsLoaded  = m.audits_loaded   ?? 17.0;
  const auditStatsDone = m.audit_stats_done ?? 20.0;
  const auditLinger   = m.audit_linger_done ?? 23.0;
  const backOverview  = m.back_overview   ?? 25.0;
  const finalT        = m.final           ?? dur - 1;

  // Build zoom expression:
  // Phase A: zoom into KPI score (1.0→1.28 from kpiScoreStart-0.5 to kpiScoreStart+1)
  //          hold at 1.28 until kpiScoreDone-0.5
  //          zoom out (1.28→1.0 from kpiScoreDone-0.5 to kpiScoreDone+0.5)
  // Phase B: zoom into audit results (1.0→1.22 from auditsLoaded+1 to auditsLoaded+2.5)
  //          hold until auditLinger
  //          zoom out (1.22→1.0 from auditLinger to auditLinger+1.5)

  const zA_inS  = Math.max(0, kpiScoreStart - 0.3);
  const zA_inE  = Math.min(dur, kpiScoreStart + 1.2);
  const zA_outS = Math.max(zA_inE, kpiScoreDone - 0.3);
  const zA_outE = Math.min(dur, kpiScoreDone + 0.8);

  const zB_inS  = Math.max(0, auditsLoaded + 0.8);
  const zB_inE  = Math.min(dur, auditsLoaded + 2.2);
  const zB_outS = Math.max(zB_inE, auditLinger - 0.2);
  const zB_outE = Math.min(dur, auditLinger + 1.2);

  // FFmpeg expression for zoom factor (evaluated per frame, t = pts in seconds)
  // Uses piecewise linear ramp: clamp((t-s)/(e-s), 0, 1)
  const clamp = (expr) => `min(1,max(0,${expr}))`;
  const rampUp   = (s, e) => clamp(`(t-${s.toFixed(3)})/${(e - s).toFixed(3)}`);
  const rampDown = (s, e) => clamp(`(${e.toFixed(3)}-t)/${(e - s).toFixed(3)}`);

  const zA_max = 1.28;
  const zB_max = 1.22;

  // Zoom A: in during [zA_inS, zA_inE], hold, out during [zA_outS, zA_outE]
  const zA_expr = `${zA_max - 1}*if(lt(t,${zA_inE.toFixed(3)}),${rampUp(zA_inS, zA_inE)},if(lt(t,${zA_outS.toFixed(3)}),1,${rampDown(zA_outS, zA_outE)}))`;

  // Zoom B: in during [zB_inS, zB_inE], hold, out during [zB_outS, zB_outE]
  const zB_expr = `${zB_max - 1}*if(lt(t,${zB_inE.toFixed(3)}),${rampUp(zB_inS, zB_inE)},if(lt(t,${zB_outS.toFixed(3)}),1,${rampDown(zB_outS, zB_outE)}))`;

  // Combined zoom: only one phase active at a time
  const zoomExpr = `1+(${zA_expr})+(${zB_expr})`;

  // Crop anchor: zoom A centered on KPI area (top-center), zoom B centered on audits table (center)
  // When zA active: anchor top-center (cropX=0.5, cropY=0.15)
  // When zB active: anchor center (cropX=0.4, cropY=0.4)
  const zA_active = `gt(t,${zA_inS.toFixed(3)})*lt(t,${zA_outE.toFixed(3)})`;
  const zB_active = `gt(t,${zB_inS.toFixed(3)})*lt(t,${zB_outE.toFixed(3)})`;

  const cropXFrac = `(${zA_active}*0.5+(1-${zA_active})*(${zB_active}*0.4+(1-${zB_active})*0.5))`;
  const cropYFrac = `(${zA_active}*0.12+(1-${zA_active})*(${zB_active}*0.38+(1-${zB_active})*0.5))`;

  // Scale + crop filter
  const zoomFilter = [
    `scale=iw*${zoomExpr}:ih*${zoomExpr}:eval=frame`,
    `crop=${W}:${H}:(iw-${W})*${cropXFrac}:(ih-${H})*${cropYFrac}:eval=frame`,
  ].join(',');

  // Callout text overlays — drawtext
  // Style: white text on semi-transparent FlowPoint blue rectangle
  // boxcolor=0x1d4ed8@0.88 (blue-700), fontsize 30, box border 14
  const fp = FONT;
  const callouts = [
    // "Votre score SEO" — shown during KPI zoom A
    {
      text: 'Votre score SEO',
      enable: `between(t,${Math.max(0, zA_inE - 0.2).toFixed(2)},${Math.min(dur, zA_outS + 0.2).toFixed(2)})`,
      x: `(W-tw)/2`, y: `H-130`,
      fontsize: 30, color: 'white', box: '0x1e40af@0.90', border: 16,
    },
    // "Priorités détectées automatiquement" — during insights scroll
    {
      text: 'Priorites detectees automatiquement',
      enable: `between(t,${(insightsDone - 4.0).toFixed(2)},${(insightsDone + 1.5).toFixed(2)})`,
      x: `(W-tw)/2`, y: `H-130`,
      fontsize: 30, color: 'white', box: '0x1e40af@0.90', border: 16,
    },
    // "Audits SEO & actions correctives" — during audits zoom B
    {
      text: 'Audits SEO & actions correctives',
      enable: `between(t,${Math.max(0, zB_inE - 0.2).toFixed(2)},${Math.min(dur, zB_outS + 0.2).toFixed(2)})`,
      x: `(W-tw)/2`, y: `H-130`,
      fontsize: 30, color: 'white', box: '0x1e40af@0.90', border: 16,
    },
    // "FlowPoint centralise votre visibilite" — final overview pan
    {
      text: 'FlowPoint centralise votre visibilite',
      enable: `between(t,${Math.max(0, backOverview + 2.0).toFixed(2)},${Math.min(dur, finalT + 0.5).toFixed(2)})`,
      x: `(W-tw)/2`, y: `H-130`,
      fontsize: 30, color: 'white', box: '0x1e40af@0.90', border: 16,
    },
  ];

  // Build drawtext filter chain
  const drawtextFilters = callouts.map(c =>
    `drawtext=fontfile='${fp}':text='${c.text}':fontsize=${c.fontsize}:fontcolor=${c.color}:` +
    `box=1:boxcolor=${c.box}:boxborderw=${c.border}:x='${c.x}':y='${c.y}':enable='${c.enable}'`
  ).join(',');

  // Fade in/out
  const fadeFilter = `fade=t=in:st=0:d=${fadeInDur}:color=black,fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${fadeOutDur}:color=black`;

  // Full filter chain
  const vf = [zoomFilter, drawtextFilters, fadeFilter].join(',');

  console.log(`  FFmpeg step 2: zoom + callouts + fades → ${out}`);
  console.log(`    Zoom A: t=${zA_inS.toFixed(1)}–${zA_outE.toFixed(1)}s (×${zA_max})`);
  console.log(`    Zoom B: t=${zB_inS.toFixed(1)}–${zB_outE.toFixed(1)}s (×${zB_max})`);

  r = spawnSync('ffmpeg', [
    '-y',
    '-i', raw,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-an',
    out,
  ], { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });

  if (r.status !== 0) {
    const errLog = r.stderr?.toString() ?? '';
    console.error('FFmpeg step 2 stderr (last 1000):', errLog.slice(-1000));
    throw new Error('post-process failed');
  }

  return out;
}

// ── Capture screenshots at key timestamps ────────────────────────────────────
function captureFrames(mp4) {
  const timestamps = [0.5, 'kpi_score_focus', 'insights_done', 'audits_loaded', 'audit_rows_done', 'back_overview'];
  const frames = [];
  for (const ts of timestamps) {
    const t = typeof ts === 'number' ? ts : Math.max(0, (marks[ts] ?? 0) + 0.5);
    const out = join(OUT_DIR, `frame_${typeof ts === 'string' ? ts : ts.toFixed(1)}.jpg`);
    const r = spawnSync('ffmpeg', [
      '-y', '-ss', t.toFixed(2), '-i', mp4,
      '-vframes', '1', '-q:v', '3', '-vf', `scale=960:540`,
      out,
    ], { stdio: 'pipe' });
    if (r.status === 0) {
      frames.push({ label: String(ts), time: t.toFixed(2), path: out });
      console.log(`  Frame [${ts}] t=${t.toFixed(2)}s → ${out}`);
    }
  }
  return frames;
}

// ── QA probes ─────────────────────────────────────────────────────────────────
function qaProbe(mp4) {
  const info = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,bit_rate:format=duration,size,bit_rate',
    '-of', 'default=nw=1', mp4,
  ], { stdio: 'pipe' }).stdout.toString();
  console.log('  QA probe:\n' + info);
  return info;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('▶ Seeding demo data…');
const seedResult = await seed();
console.log('  ', JSON.stringify(seedResult?.inserted ?? seedResult).slice(0, 120));

const token = await getToken();
console.log('  Token ok\n');

console.log('▶ Recording V1 at 1920×1080…');
const { webm, skipMs } = await record(v1, token);

if (process.env.SKIP_LEGACY_POSTPROCESS === '1') {
  console.log(`\n✓ Raw recording ready: ${webm}`);
  process.exit(0);
}

console.log('\n▶ Post-processing (zooms + callouts + fades)…');
const finalMp4 = postProcess(webm, skipMs);

console.log('\n▶ QA probe…');
qaProbe(finalMp4);

console.log('\n▶ Capturing frames at key timestamps…');
const frames = captureFrames(finalMp4);

// Copy to destination
spawnSync('cp', [finalMp4, join(DEST_DIR, 'step1-interface.mp4')]);
console.log(`\n✓  step1-interface.mp4 → ${DEST_DIR}`);

const dur = parseFloat(
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', finalMp4], { stdio: 'pipe' }).stdout.toString().trim()
);
const size = spawnSync('stat', ['-c', '%s', finalMp4], { stdio: 'pipe' }).stdout.toString().trim();

console.log('\n══════════════════════════════════════');
console.log('V1 PILOT — RÉSULTATS');
console.log(`  Résolution : ${W}×${H}`);
console.log(`  Durée      : ${dur.toFixed(1)}s`);
console.log(`  Taille     : ${(parseInt(size) / 1024 / 1024).toFixed(1)} Mo`);
console.log(`  Fichier    : ${join(DEST_DIR, 'step1-interface.mp4')}`);
console.log('══════════════════════════════════════');
console.log('\nMarks (timestamps post-trim) :');
for (const [k, v] of Object.entries(marks)) {
  console.log(`  ${k.padEnd(24)} ${v.toFixed(2)}s`);
}
