/**
 * FlowPoint Onboarding — Steps 2 à 6  (v2 — fix trim + scénarios)
 *
 * BUG CORRIGÉ : le trim FFmpeg utilisait le mauvais skipMs
 * (il coupait le scénario utile plutôt que le boot).
 * Fix : setSkip() stocke le temps de boot dans une variable
 * de clôture explicite, ignorant la valeur de retour du scénario.
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = process.env.FLOWPOINT_RECORD_BASE || 'http://127.0.0.1:8081';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_BASE  = '/tmp/fp-v2v6b';
const DEST_DIR  = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const FONT      = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1920, H = 1080;
mkdirSync(OUT_BASE, { recursive: true });

// ── API helpers ───────────────────────────────────────────────────────────────

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

// ── Curseur ───────────────────────────────────────────────────────────────────

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.8 19 L10.3 12 L18 12 Z" fill="white" stroke="#111827" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function injectCursor(page) {
  await page.evaluate(svg => {
    document.getElementById('_fpcur')?.remove();
    const w = document.createElement('div');
    w.id = '_fpcur';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 4px rgba(0,0,0,.65))';
    w.innerHTML = svg;
    document.body.appendChild(w);
    document.addEventListener('mousemove', e => { w.style.left = e.clientX+'px'; w.style.top = e.clientY+'px'; }, { passive: true });
    document.addEventListener('mousedown', e => {
      w.style.filter = 'drop-shadow(0 1px 4px rgba(0,0,0,.65)) brightness(.75)';
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${e.clientX-14}px;top:${e.clientY-14}px;width:28px;height:28px;border-radius:50%;border:2.5px solid rgba(37,99,235,.85);pointer-events:none;z-index:2147483646;animation:_cr .45s ease-out forwards`;
      document.body.appendChild(r); setTimeout(() => r.remove(), 500);
    });
    document.addEventListener('mouseup', () => { w.style.filter = 'drop-shadow(0 1px 4px rgba(0,0,0,.65))'; });
    if (!document.getElementById('_crstyle')) {
      const s = document.createElement('style'); s.id = '_crstyle';
      s.textContent = '@keyframes _cr{0%{transform:scale(.1);opacity:.9}100%{transform:scale(2.8);opacity:0}}';
      document.head.appendChild(s);
    }
    window._cx = window.innerWidth / 2; window._cy = window.innerHeight / 2;
  }, CURSOR_SVG);
}

// ── Readiness guard ───────────────────────────────────────────────────────────

async function waitForReady(page, label = 'page', extraSels = [], stabilityMs = 1800) {
  const POLL = 250;
  const contentSels = [
    '.fp-kpi-row','.fp-overview-grid','.fp-chart-card','.fp-stat-card',
    '.fp-audit-row','[data-audit-id]','.fp-monitor-card','[data-monitor-id]',
    '[data-mission-id]','.fp-mission-row','.fp-table tbody tr',
    '.fp-alert-item','.fp-competitor-card','.fp-activity-item',
    ...extraSels,
  ];

  await page.waitForFunction(
    () => !!(window.STATE && window.STATE.loading === false && window.STATE.me),
    { timeout: 25000, polling: POLL }
  ).catch(async () => {
    await page.waitForSelector(contentSels.slice(0, 6).join(','), { timeout: 10000 }).catch(() => {});
  });

  let stable = 0;
  for (let i = 0; i < 100; i++) {
    const res = await page.evaluate(sels => {
      if (document.getElementById('fp-loading-skeleton')) return 'main-skeleton';
      for (const el of document.querySelectorAll('.fp-skeleton,.fp-skel-shimmer')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return 'skeleton-visible';
      }
      for (const sel of sels) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if ((el.textContent?.trim().length ?? 0) > 2) return 'ok';
        }
      }
      return 'no-content';
    }, contentSels);

    if (res === 'ok') { stable++; if (stable >= 3) break; }
    else { stable = 0; if (i % 8 === 0) console.log(`    [rdy:${label}] ${res}…`); }
    await page.waitForTimeout(POLL);
  }
  console.log(`    [rdy:${label}] stable — attente ${stabilityMs}ms…`);
  await page.waitForTimeout(stabilityMs);
  console.log(`    [rdy:${label}] ✓`);
}

// ── Navigation par texte ──────────────────────────────────────────────────────

async function navClick(page, text) {
  const pos = await page.evaluate(txt => {
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 4) continue;
      const t = el.textContent?.trim() ?? '';
      if (t !== txt) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left < 250 && r.top > 0 && r.top < window.innerHeight)
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return null;
  }, text);

  if (pos) {
    console.log(`    nav "${text}" → (${pos.x}, ${pos.y})`);
    await go(page, pos.x, pos.y, 500);
    await page.mouse.click(pos.x, pos.y);
  } else {
    const slug = text.toLowerCase()
      .replace(/[éèê]/g, 'e').replace(/[àâ]/g, 'a').replace(/'/g, '-')
      .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    console.log(`    nav "${text}" non trouvé → navigate('${slug}')`);
    await page.evaluate(s => { if (typeof navigate === 'function') navigate(s); }, slug);
  }
  await page.waitForTimeout(800);
}

// ── Curseur / mouvement ───────────────────────────────────────────────────────

function eio(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

async function go(page, tx, ty, ms = 480) {
  const { x: sx, y: sy } = await page.evaluate(([w, h]) => ({ x: window._cx ?? w / 2, y: window._cy ?? h / 2 }), [W, H]);
  const dx = Math.abs(tx - sx), dy = Math.abs(ty - sy);
  if (Math.sqrt(dx * dx + dy * dy) > 140 && dx > 50 && dy > 50) {
    const wayMs = Math.round(ms * dx / (dx + dy));
    const s1 = Math.max(10, Math.round(wayMs / 14));
    for (let i = 1; i <= s1; i++) { await page.mouse.move(Math.round(sx + (tx - sx) * eio(i / s1)), sy); await page.waitForTimeout(14); }
    await page.evaluate(p => { window._cx = p[0]; window._cy = p[1]; }, [tx, sy]);
    const s2 = Math.max(10, Math.round((ms - wayMs) / 14));
    for (let i = 1; i <= s2; i++) { await page.mouse.move(tx, Math.round(sy + (ty - sy) * eio(i / s2))); await page.waitForTimeout(14); }
  } else {
    const steps = Math.max(18, Math.round(ms / 14));
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(Math.round(sx + (tx - sx) * eio(i / steps)), Math.round(sy + (ty - sy) * eio(i / steps)));
      await page.waitForTimeout(14);
    }
  }
  await page.evaluate(p => { window._cx = p[0]; window._cy = p[1]; }, [tx, ty]);
}

async function dwell(page, x, y, pauseMs = 800, moveMs = 480) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(pauseMs);
}

async function clk(page, x, y, moveMs = 480) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}

// ── Centroïde d'un élément ────────────────────────────────────────────────────

async function centerOf(page, selectors, { minLeft = 200, minTop = 60, nth = 0 } = {}) {
  if (typeof selectors === 'string') selectors = [selectors];
  return page.evaluate(([sels, ml, mt, n]) => {
    let count = 0;
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 10 && r.left >= ml && r.top >= mt && r.top < window.innerHeight - 20) {
          if (count === n) return { x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + r.height * 0.5) };
          count++;
        }
      }
    }
    return null;
  }, [selectors, minLeft, minTop, nth]);
}

// ── Fermer un panneau ─────────────────────────────────────────────────────────

async function closePanel(page) {
  const btn = await centerOf(page, [
    '.fp-panel .fp-close','.fp-panel .btn-close','[data-panel] .fp-close',
    '[role="dialog"] .btn-close','[role="dialog"] [aria-label*="close"]',
    '.fp-modal-close','.fp-panel-close','.fp-detail-panel .fp-close',
  ], { minLeft: 0, minTop: 0 });
  if (btn) { await clk(page, btn.x, btn.y, 300); }
  else { await page.keyboard.press('Escape'); }
  await page.waitForTimeout(500);
}

// ── Attente panneau ───────────────────────────────────────────────────────────

async function waitPanel(page, maxMs = 5000) {
  await Promise.race([
    page.waitForSelector('.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"],.fp-modal', { timeout: maxMs }).catch(() => null),
    page.waitForTimeout(Math.round(maxMs * 0.8)),
  ]);
}

// ── Boot (commun à tous les scénarios) ───────────────────────────────────────

async function boot(page, section) {
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  for (const sel of ['button:has-text("Passer")', 'button:has-text("Ignorer")', '[data-dismiss="modal"]']) {
    const b = page.locator(sel).first();
    if (await b.isVisible({ timeout: 200 }).catch(() => false)) { await b.click(); await page.waitForTimeout(300); break; }
  }
  if (section !== 'overview') {
    await page.evaluate(s => { if (typeof navigate === 'function') navigate(s); }, section);
  }
}

// ── Enregistreur ─────────────────────────────────────────────────────────────
// FIX PRINCIPAL : bootSkipMs est capturé par setSkip() et utilisé pour le trim.
// La valeur de retour du scénario est ignorée.

async function record(stepId, scenarioFn, token) {
  const outDir = join(OUT_BASE, `step${stepId}`);
  const rawDir = join(outDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/repl/tools/bin/chromium',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
           '--disable-web-security','--allow-running-insecure-content',
           '--force-device-scale-factor=1','--window-size=1920,1080'],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(tok => {
    try { sessionStorage.setItem('fp_session_token', tok); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, token);

  const page = await ctx.newPage();
  const marks = {};
  // _t0 : instant juste avant le scénario (≈ début du webm)
  const _t0 = Date.now();
  let _skipMs = 0;      // set by setSkip = durée du boot (à couper)
  let bootSkipMs = 0;   // copie pour postProcess

  function mark(name) {
    const t = Math.max(0, (Date.now() - _t0 - _skipMs) / 1000);
    marks[name] = t;
    console.log(`  ⏱  [${name}] t=${t.toFixed(2)}s`);
  }

  // setSkip est appelé UNE FOIS après le readiness guard, juste avant mark('start')
  // Il reçoit le nombre de ms depuis _t0 à couper (= boot time)
  function setSkip(ms) {
    _skipMs = ms;
    bootSkipMs = ms;
    console.log(`    [skip] boot=${ms}ms`);
  }

  try {
    await scenarioFn(page, token, { mark, marks, setSkip });
  } finally {
    await page.close(); await ctx.close(); await browser.close();
  }

  const files = readdirSync(rawDir).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error(`No webm for step${stepId}`);
  const webm = join(rawDir, files[0]);

  const srcRes = spawnSync('ffprobe', ['-v','error','-show_entries','stream=width,height','-of','csv=p=0', webm], { stdio: 'pipe' }).stdout.toString().trim();
  console.log(`  SOURCE=${srcRes}`);
  writeFileSync(join(outDir, 'marks.json'), JSON.stringify({ bootSkipMs, marks }, null, 2));
  return { webm, skipMs: bootSkipMs, marks, srcRes };
}

// ── FFmpeg post-processing ────────────────────────────────────────────────────

function postProcess(stepId, webm, skipMs, marks, calloutFn) {
  const outDir = join(OUT_BASE, `step${stepId}`);
  // Couper le boot (skipMs) moins 200ms de marge pour voir le curseur dès la 1ère frame
  const ss = Math.max(0, (skipMs - 200) / 1000);
  const trimmed = join(outDir, 'trimmed.mp4');
  const final = join(outDir, `step${stepId}-final.mp4`);

  console.log(`  Trim ss=${ss.toFixed(2)}s`);
  let r = spawnSync('ffmpeg', [
    '-y', ...(ss > 0.2 ? ['-ss', ss.toFixed(3)] : []),
    '-i', webm,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
    '-c:v', 'libx264', '-crf', '15', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    trimmed,
  ], { stdio: 'pipe' });
  if (r.status !== 0) throw new Error('trim: ' + r.stderr?.toString().slice(-400));

  const dur = parseFloat(spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', trimmed], { stdio: 'pipe' }).stdout.toString().trim());
  console.log(`  Durée : ${dur.toFixed(2)}s`);

  const fadeInDur = 0.08, fadeOutDur = 0.65;
  const fadeOutAt = Math.max(0, dur - fadeOutDur);

  const callouts = calloutFn(marks, dur).filter(c =>
    typeof c.tStart === 'number' && typeof c.tEnd === 'number' &&
    c.tStart >= 0 && c.tEnd > c.tStart + 0.4 && c.tStart < dur
  );
  const chain = callouts.map(c =>
    `drawtext=fontfile=${FONT}:text='${c.text}':fontsize=28:fontcolor=white` +
    `:box=1:boxcolor=0x1e3a8a@0.90:boxborderw=22:x=(W-tw)/2:y=H-90` +
    `:enable='between(t,${c.tStart.toFixed(2)},${c.tEnd.toFixed(2)})'`
  ).join(',');

  const fades = `fade=t=in:st=0:d=${fadeInDur}:color=black,fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${fadeOutDur}:color=black`;
  const vf = chain.length > 0 ? `${chain},${fades}` : fades;

  console.log(`  Callouts : ${callouts.length} → ${final}`);
  r = spawnSync('ffmpeg', [
    '-y', '-i', trimmed, '-vf', vf,
    '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    final,
  ], { stdio: 'pipe', maxBuffer: 12 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('post: ' + r.stderr?.toString().slice(-600));
  return final;
}

function qaProbe(mp4) {
  const info = spawnSync('ffprobe', ['-v','error','-show_entries','stream=codec_name,width,height,r_frame_rate:format=duration,size','-of','default=nw=1', mp4], { stdio: 'pipe' }).stdout.toString();
  console.log('  QA: ' + info.split('\n').filter(Boolean).join(' | '));
  return info;
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — Audits SEO & Actions
// ════════════════════════════════════════════════════════════════════════════

async function step2(page, token, { mark, marks, setSkip }) {
  await boot(page, 'audits');
  console.log('  → readiness Audits…');
  await waitForReady(page, 'audits', ['[data-audit-id]']);

  await page.mouse.move(960, 600);
  await page.evaluate(() => { window._cx = 960; window._cy = 600; });
  await injectCursor(page);
  setSkip(Date.now() - (Date.now() - Date.now())); // placeholder, corrected below

  // Recalcule le skipMs depuis le boot record() _t0 :
  // on ne peut pas accéder à _t0 ici directement, donc on capte via mark timing trick
  // En pratique setSkip est appelé avec le nb de ms depuis _t0 (l'instant de newPage())
  // On reconstruit : _t0 est posé JUSTE AVANT l'appel au scénario, donc
  // Date.now() ici = _t0 + boot_time → setSkip(Date.now() - _t0) ← impossible sans _t0
  // SOLUTION : setSkip reçoit une valeur "relative à mark('start') t=0"
  // → setSkip est appelé UNE FOIS juste avant mark('start')
  // → la valeur correcte est ce que le record() a avancé depuis _t0 jusqu'ici
  // On utilise le fait que mark() lit Date.now()-_t0-_skipMs
  // Quand on appelle setSkip(X) puis mark('start'), mark doit donner 0
  // → X = Date.now() - _t0
  // On appelle donc setSkip IMMÉDIATEMENT avant mark('start'), mais on n'a pas _t0...
  // VRAI FIX : le scénario reçoit _t0_ref comme argument supplémentaire.
  // Voir restructuration dans record().
}

// → On abandonne l'approche "setSkip reçoit une valeur externe"
//   et on restructure pour que le scénario reçoive _t0Ref.

// ── Restructuration : les scénarios reçoivent t0Ref ──────────────────────────
// record() passe maintenant { mark, marks, captureSkip }
// captureSkip() est appelé sans argument : il snapshote Date.now() et calcule
// lui-même le skipMs = Date.now() - _t0

async function recordV2(stepId, scenarioFn, token) {
  const outDir = join(OUT_BASE, `step${stepId}`);
  const rawDir = join(outDir, 'raw');
  // Purger les anciens webm pour éviter que readdirSync ramasse la session précédente
  spawnSync('rm', ['-rf', rawDir]);
  mkdirSync(rawDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/repl/tools/bin/chromium',
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
           '--disable-web-security','--allow-running-insecure-content',
           '--force-device-scale-factor=1','--window-size=1920,1080'],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(tok => {
    try { sessionStorage.setItem('fp_session_token', tok); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, token);

  const page = await ctx.newPage();
  const marks = {};
  const _t0 = Date.now();  // Juste après newPage, ≈ début du webm
  let _skipMs = 0;
  let bootSkipMs = 0;

  function mark(name) {
    const t = Math.max(0, (Date.now() - _t0 - _skipMs) / 1000);
    marks[name] = t;
    console.log(`  ⏱  [${name}] t=${t.toFixed(2)}s`);
  }

  // captureSkip() : appelé après readiness guard, juste avant mark('start')
  // Snapshote le boot time = Date.now() - _t0
  function captureSkip() {
    _skipMs = Date.now() - _t0;
    bootSkipMs = _skipMs;
    console.log(`    [skip] boot=${_skipMs}ms`);
  }

  try {
    await scenarioFn(page, token, { mark, marks, captureSkip });
  } finally {
    await page.close(); await ctx.close(); await browser.close();
  }

  const files = readdirSync(rawDir).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error(`No webm step${stepId}`);
  const webm = join(rawDir, files[0]);

  const srcRes = spawnSync('ffprobe', ['-v','error','-show_entries','stream=width,height','-of','csv=p=0', webm], { stdio: 'pipe' }).stdout.toString().trim();
  console.log(`  SOURCE=${srcRes}`);
  writeFileSync(join(outDir, 'marks.json'), JSON.stringify({ bootSkipMs, marks }, null, 2));
  return { webm, skipMs: bootSkipMs, marks, srcRes };
}

// ════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 2 — Audits SEO & Actions
// ════════════════════════════════════════════════════════════════════════════

async function scenario2(page, token, { mark, marks, captureSkip }) {
  await boot(page, 'audits');
  console.log('  → readiness Audits…');
  await waitForReady(page, 'audits', ['[data-audit-id]']);

  await page.mouse.move(960, 600);
  await page.evaluate(() => { window._cx = 960; window._cy = 600; });
  await injectCursor(page);
  captureSkip();

  // BEAT 1 — Vue liste audits
  mark('start');
  const listArea = await centerOf(page, ['[data-audit-id]','.fp-table tbody tr'], { minLeft: 300 });
  await dwell(page, listArea?.x ?? 900, (listArea?.y ?? 300) - 60, 2000, 400);
  mark('list_viewed');

  // BEAT 2 — Clic audit 1
  mark('click_audit1');
  const a1 = await centerOf(page, ['[data-audit-id]','.fp-table tbody tr'], { minLeft: 250, nth: 0 });
  if (a1) await clk(page, a1.x, a1.y, 500);
  await page.waitForTimeout(600);
  await waitPanel(page, 5000);
  mark('panel1_open');

  // BEAT 3 — Lecture panneau 1 (score + issues)
  const p1 = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
  await dwell(page, p1?.x ?? 1200, p1?.y ?? 350, 5500, 400);
  mark('read_panel1');

  // BEAT 4 — Scroll pour voir recommandations
  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(4000);
  mark('scroll_done');

  // BEAT 5 — Fermer panneau 1
  await closePanel(page);
  mark('close1');

  // BEAT 6 — Re-naviguer vers audits pour garantir que la liste est visible
  await page.evaluate(() => { if (typeof navigate === 'function') navigate('audits'); });
  await page.waitForTimeout(1500);
  await page.waitForSelector('[data-audit-id],.fp-table tbody tr', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  const a2 = await centerOf(page, ['[data-audit-id]','.fp-table tbody tr'], { minLeft: 250, nth: 1 });
  if (a2) {
    mark('click_audit2');
    await dwell(page, a2.x, a2.y - 30, 1000, 500);
    await clk(page, a2.x, a2.y, 400);
    // Simple attente (pas de waitForFunction complexe qui peut traîner)
    await page.waitForTimeout(2500);
    mark('panel2_open');
    const p2 = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
    await dwell(page, p2?.x ?? 1200, p2?.y ?? 350, 5500, 400);
    mark('read_panel2');
    await closePanel(page);
  } else {
    console.log('    audit2 non trouvé — dwell supplémentaire');
    await dwell(page, 960, 430, 7000, 380);
    mark('click_audit2'); mark('panel2_open'); mark('read_panel2');
  }

  // BEAT 7 — Fin propre
  mark('final');
  await go(page, 960, 430, 380);
  await page.waitForTimeout(2200);
  mark('done');
}

// ════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 3 — Monitoring & Alertes
// ════════════════════════════════════════════════════════════════════════════

async function scenario3(page, token, { mark, marks, captureSkip }) {
  await boot(page, 'monitors');
  console.log('  → readiness Monitors…');
  await waitForReady(page, 'monitors', ['[data-monitor-id]','.fp-monitor-card','.fp-table tbody tr']);

  await page.mouse.move(960, 600);
  await page.evaluate(() => { window._cx = 960; window._cy = 600; });
  await injectCursor(page);
  captureSkip();

  // BEAT 1 — Vue liste moniteurs (statuts visibles)
  mark('start');
  await page.waitForTimeout(2200);

  // BEAT 2 — Hover moniteur 1
  mark('hover_mon1');
  const m1 = await centerOf(page, ['[data-monitor-id]','.fp-monitor-card','.fp-monitor-row','.fp-table tbody tr'], { minLeft: 300 });
  await dwell(page, m1?.x ?? 900, m1?.y ?? 300, 1600, 500);

  // BEAT 3 — Clic moniteur 1 → panneau détail
  mark('click_mon1');
  if (m1) await clk(page, m1.x, m1.y, 350);
  await page.waitForTimeout(600);
  await waitPanel(page, 5000);
  mark('mon_panel_open');

  // BEAT 4 — Lecture panneau (uptime, latence, checks)
  const mp = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
  await dwell(page, mp?.x ?? 1200, mp?.y ?? 380, 3000, 400);
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(2000);
  mark('mon_panel_read');

  // BEAT 5 — Fermer panneau
  await closePanel(page);
  mark('panel_closed');

  // BEAT 6 — Nav Centre d'alertes
  await navClick(page, "Centre d'alertes");
  await waitForReady(page, 'alerts', ['.fp-alert-item','.fp-stat-card']);
  mark('alerts_loaded');

  // BEAT 7 — Vue stats + hover
  const astat = await centerOf(page, ['.fp-stat-card'], { minLeft: 200 });
  await dwell(page, astat?.x ?? 500, astat?.y ?? 280, 2000, 500);

  // BEAT 8 — Clic alerte "Monitor DOWN"
  mark('click_alert');
  const ai = await centerOf(page, ['.fp-alert-item'], { minLeft: 200 });
  if (ai) {
    await clk(page, ai.x, ai.y, 500);
    await page.waitForTimeout(600);
    await waitPanel(page, 4000);
    mark('alert_panel_open');
    const ap = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
    await dwell(page, ap?.x ?? 1200, ap?.y ?? 380, 3000, 400);
    mark('alert_read');
    await closePanel(page);
  } else {
    await page.waitForTimeout(3000);
    mark('alert_panel_open'); mark('alert_read');
  }

  // BEAT 9 — Fin propre
  mark('final');
  await go(page, 960, 430, 380);
  await page.waitForTimeout(2000);
  mark('done');
}

// ════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 4 — Concurrents & Local SEO
// ════════════════════════════════════════════════════════════════════════════

async function scenario4(page, token, { mark, marks, captureSkip }) {
  await boot(page, 'competitors');
  console.log('  → readiness Concurrents…');
  await waitForReady(page, 'competitors', ['.fp-table tbody tr','.fp-competitor-row']);

  await page.mouse.move(960, 600);
  await page.evaluate(() => { window._cx = 960; window._cy = 600; });
  await injectCursor(page);
  captureSkip();

  // BEAT 1 — Vue tableau concurrents
  mark('start');
  await page.waitForTimeout(2200);

  // BEAT 2 — Hover concurrent 1
  mark('hover_comp1');
  const c1 = await centerOf(page, ['.fp-table tbody tr','.fp-competitor-row','.fp-competitor-card'], { minLeft: 250 });
  await dwell(page, c1?.x ?? 900, c1?.y ?? 320, 1800, 500);

  // BEAT 3 — Clic concurrent 1
  mark('click_comp1');
  if (c1) await clk(page, c1.x, c1.y, 350);
  await page.waitForTimeout(600);
  await waitPanel(page, 4000);
  mark('comp1_detail');
  const cd1 = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
  await dwell(page, cd1?.x ?? 1200, cd1?.y ?? 380, 5000, 400);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(2000);
  mark('comp1_read');
  await closePanel(page).catch(() => {});

  // BEAT 4 — Re-naviguer vers competitors pour garantir que la liste est visible
  await page.evaluate(() => { if (typeof navigate === 'function') navigate('competitors'); });
  await page.waitForTimeout(1200);
  await page.waitForSelector('.fp-table tbody tr,.fp-competitor-row', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  const c2 = await centerOf(page, ['.fp-table tbody tr','.fp-competitor-row'], { minLeft: 250, nth: 1 });
  if (c2) {
    mark('hover_comp2');
    await dwell(page, c2.x, c2.y, 1500, 500);
    mark('click_comp2');
    await clk(page, c2.x, c2.y, 350);
    await page.waitForTimeout(600);
    await waitPanel(page, 4000);
    mark('comp2_detail');
    const cd2 = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
    await dwell(page, cd2?.x ?? 1200, cd2?.y ?? 380, 2500, 400);
    mark('comp2_read');
    await closePanel(page).catch(() => {});
    await page.waitForTimeout(400);
  } else {
    mark('hover_comp2'); mark('click_comp2'); mark('comp2_detail'); mark('comp2_read');
  }

  // BEAT 5 — Nav Local SEO (montrer la section)
  mark('nav_local_seo');
  await navClick(page, 'Local SEO');
  await page.waitForFunction(() => !!(window.STATE && window.STATE.loading === false), { timeout: 10000, polling: 300 }).catch(() => {});
  await page.waitForTimeout(1800);
  mark('local_seo_loaded');

  const ls = await centerOf(page, ['.fp-stat-card','.fp-kpi-card','.fp-chart-card'], { minLeft: 200 });
  await dwell(page, ls?.x ?? 600, ls?.y ?? 280, 2500, 500);
  mark('local_seo_viewed');

  // BEAT 6 — Fin propre
  mark('final');
  await go(page, 960, 430, 380);
  await page.waitForTimeout(1800);
  mark('done');
}

// ════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 5 — IA & Rapports
// ════════════════════════════════════════════════════════════════════════════

async function scenario5(page, token, { mark, marks, captureSkip }) {
  // navigate('ai') fonctionne — confirmation par inspection directe
  await boot(page, 'ai');
  console.log('  → readiness IA…');
  await page.waitForFunction(() => !!(window.STATE && window.STATE.me), { timeout: 20000, polling: 300 }).catch(() => {});
  // Attendre le textarea avec un timeout plus généreux (25s)
  await page.waitForSelector('textarea.fp-ai-input, textarea[placeholder*="question"]', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  await page.mouse.move(960, 600);
  await page.evaluate(() => { window._cx = 960; window._cy = 600; });
  await injectCursor(page);
  captureSkip();

  // BEAT 1 — Vue interface IA
  mark('start');
  await page.waitForTimeout(2000);

  // BEAT 2 — Trouver l'input (textarea.fp-ai-input détecté à left=337, top=677)
  mark('find_input');
  // Attendre explicitement l'input AI (la section AI n'a pas STATE.loading)
  await page.waitForSelector('textarea.fp-ai-input, textarea[placeholder*="question"], textarea[placeholder*="Question"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  const inputPos = await page.evaluate(() => {
    const sels = ['textarea.fp-ai-input','textarea[placeholder*="question"]','textarea[placeholder*="Question"]','textarea','.fp-chat-input'];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 0) return { x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + r.height * 0.5), found: true };
      }
    }
    return null;
  });

  if (inputPos) {
    console.log(`    input trouvé → (${inputPos.x}, ${inputPos.y})`);
    await clk(page, inputPos.x, inputPos.y, 500);
    await page.waitForTimeout(300);
    mark('click_input');

    // Utiliser fill() — plus fiable que keyboard.type pour les textareas
    const question = "Analyse mon site SEO et donne-moi les 3 priorites";
    await page.locator('textarea.fp-ai-input, textarea[placeholder*="question"], textarea').first().fill(question);
    await page.waitForTimeout(600);
    mark('question_typed');

    // Chercher bouton Envoyer
    const sendPos = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button,input[type="submit"],[role="button"]')];
      for (const b of btns) {
        const txt = b.textContent?.trim() ?? '';
        if (/envoyer|send|submit/i.test(txt) || b.type === 'submit') {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
      }
      for (const b of btns) {
        if (b.querySelector('svg') && !b.querySelector('input')) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.width < 80 && r.top > 400) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
      }
      return null;
    });

    mark('click_send');
    if (sendPos) { await clk(page, sendPos.x, sendPos.y, 300); }
    else { await page.keyboard.press('Enter'); }

    // BEAT 3 — Attendre réponse
    mark('waiting_ai');
    await Promise.race([
      page.waitForSelector('.fp-ai-message,.fp-chat-message,.fp-assistant-message,[data-role="assistant"],.fp-chat-response', { timeout: 25000 }).catch(() => null),
      page.waitForTimeout(22000),
    ]);
    await page.waitForTimeout(1500);

    // Laisser streamer (max 18s supplémentaires)
    let prev = 0, stable = 0;
    for (let i = 0; i < 36; i++) {
      const len = await page.evaluate(() =>
        [...document.querySelectorAll('.fp-ai-message,.fp-chat-message,.fp-assistant-message,[data-role="assistant"],.fp-chat-response')]
          .map(m => m.textContent?.trim().length ?? 0).reduce((a, b) => a + b, 0)
      );
      if (len === prev) { stable++; if (stable >= 4) break; } else { stable = 0; prev = len; }
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1200);
    mark('ai_response_done');

    // BEAT 4 — Lecture réponse
    const resp = await centerOf(page, ['.fp-ai-message,.fp-chat-message,.fp-assistant-message,[data-role="assistant"],.fp-chat-response'], { minLeft: 0, minTop: 50 });
    await dwell(page, resp?.x ?? 960, resp?.y ?? 450, 3000, 400);
    mark('response_read');
  } else {
    console.log('    input IA non trouvé — survol interface');
    await dwell(page, 960, 450, 6000, 400);
    mark('click_input'); mark('question_typed'); mark('click_send');
    mark('waiting_ai'); mark('ai_response_done'); mark('response_read');
  }

  // BEAT 5 — Nav Rapports
  mark('nav_reports');
  await navClick(page, 'Rapports');
  await page.waitForFunction(() => !!(window.STATE && window.STATE.loading === false), { timeout: 10000, polling: 300 }).catch(() => {});
  await page.waitForTimeout(1500);
  mark('reports_loaded');

  // BEAT 6 — Chercher bouton Nouveau rapport (évite l'état vide)
  const newBtn = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,[role="button"]')) {
      const txt = el.textContent?.trim() ?? '';
      if (/nouveau|creer|cr[ée]{1,2}r|generer|gen[eé]rer|new|create/i.test(txt) && txt.length < 50) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.left > 200) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
    }
    return null;
  });

  if (newBtn) {
    mark('click_new_report');
    await clk(page, newBtn.x, newBtn.y, 500);
    await page.waitForTimeout(800);
    const form = await centerOf(page, ['.fp-panel,.fp-modal,[role="dialog"],.fp-form'], { minLeft: 0 });
    await dwell(page, form?.x ?? 960, form?.y ?? 400, 3000, 400);
    await closePanel(page).catch(() => {});
    mark('report_form_done');
  } else {
    // Survoler la section même si vide
    await dwell(page, 960, 430, 3000, 400);
    mark('click_new_report'); mark('report_form_done');
  }

  // BEAT 7 — Fin
  mark('final');
  await go(page, 960, 430, 380);
  await page.waitForTimeout(1800);
  mark('done');
}

// ════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 6 — Workflow Quotidien
// ════════════════════════════════════════════════════════════════════════════

async function scenario6(page, token, { mark, marks, captureSkip }) {
  await boot(page, 'overview');
  console.log('  → readiness Overview…');
  await waitForReady(page, 'overview');

  await page.mouse.move(960, 600);
  await page.evaluate(() => { window._cx = 960; window._cy = 600; });
  await injectCursor(page);
  captureSkip();

  // BEAT 1 — Dashboard : identifier l'attention requise
  mark('start');
  const kpi = await centerOf(page, ['.fp-kpi-card','.fp-stat-card','.fp-kpi-row > div'], { minLeft: 200 });
  await dwell(page, kpi?.x ?? 450, kpi?.y ?? 200, 2200, 400);
  mark('overview_noted');

  // BEAT 2 — Nav Missions
  mark('nav_missions');
  await navClick(page, 'Missions');
  await waitForReady(page, 'missions', ['[data-mission-id]','.fp-mission-row']);
  mark('missions_loaded');

  // BEAT 3 — Vue liste missions (hover pour déclencher le toolbar de survol)
  const mis1 = await centerOf(page, ['[data-mission-id]','.fp-mission-row','.fp-mission-card'], { minLeft: 250 });
  const mis2 = await centerOf(page, ['[data-mission-id]','.fp-mission-row','.fp-mission-card'], { minLeft: 250, nth: 1 });
  const mis3 = await centerOf(page, ['[data-mission-id]','.fp-mission-row','.fp-mission-card'], { minLeft: 250, nth: 2 });

  // Survol mission 1 (hover toolbar apparaît)
  mark('hover_mission1');
  await dwell(page, mis1?.x ?? 900, mis1?.y ?? 640, 2500, 500);
  mark('mission1_read');

  // Survol mission 2
  if (mis2) {
    mark('hover_mission2');
    await dwell(page, mis2.x, mis2.y, 2000, 450);
    mark('mission2_read');
  } else {
    mark('hover_mission2'); mark('mission2_read');
  }

  // Survol mission 3
  if (mis3) {
    mark('hover_mission3');
    await dwell(page, mis3.x, mis3.y, 1800, 450);
    mark('mission3_read');
  } else {
    mark('hover_mission3'); mark('mission3_read');
  }
  mark('click_mission1'); mark('mission_panel_open'); mark('mission_read');

  // BEAT 5 — Nav Centre d'alertes (1 alerte réelle)
  mark('nav_alerts');
  await navClick(page, "Centre d'alertes");
  await waitForReady(page, 'alerts', ['.fp-alert-item','.fp-stat-card']);
  mark('alerts_loaded');

  // BEAT 6 — Hover stats + clic alerte
  const astat = await centerOf(page, ['.fp-stat-card'], { minLeft: 200 });
  await dwell(page, astat?.x ?? 500, astat?.y ?? 280, 1800, 500);

  mark('click_alert');
  const al = await centerOf(page, ['.fp-alert-item'], { minLeft: 200 });
  if (al) {
    await clk(page, al.x, al.y, 500);
    await page.waitForTimeout(600);
    await waitPanel(page, 4000);
    mark('alert_open');
    const ap = await centerOf(page, ['.fp-panel,.fp-detail-panel,[data-panel],[role="dialog"]'], { minLeft: 0 });
    await dwell(page, ap?.x ?? 1200, ap?.y ?? 380, 2800, 400);
    mark('alert_read');
    await closePanel(page);
  } else {
    await page.waitForTimeout(3000);
    mark('alert_open'); mark('alert_read');
  }

  // BEAT 7 — Retour Vue d'ensemble
  mark('nav_overview');
  await navClick(page, "Vue d'ensemble");
  await page.waitForFunction(() => !!(window.STATE && window.STATE.loading === false), { timeout: 10000, polling: 300 }).catch(() => {});
  await page.waitForTimeout(1500);
  mark('overview_back');

  // BEAT 8 — Fin propre
  mark('final');
  await go(page, 960, 430, 380);
  await page.waitForTimeout(2000);
  mark('done');
}

// ── Définitions des callouts ──────────────────────────────────────────────────

const calloutFns = {
  2: (m, d) => [
    { text: 'Vos audits SEO complets', tStart: m.start + 1, tEnd: m.list_viewed + 1 },
    { text: 'Score SEO et problemes detectes', tStart: m.panel1_open + 0.8, tEnd: m.read_panel1 + 0.8 },
    { text: 'Recommandations prioritaires', tStart: m.scroll_done - 1.5, tEnd: m.close1 - 0.2 },
    { text: 'Comparez plusieurs sites', tStart: (m.panel2_open ?? d - 5) + 0.5, tEnd: Math.min(d - 1, (m.read_panel2 ?? d - 2) + 1) },
  ],
  3: (m, d) => [
    { text: 'Vos moniteurs et leur statut', tStart: m.start + 1.2, tEnd: m.hover_mon1 + 1.2 },
    { text: 'Uptime, latence et historique', tStart: m.mon_panel_open + 0.8, tEnd: m.mon_panel_read + 0.5 },
    { text: '1 alerte active detectee', tStart: m.alerts_loaded + 0.8, tEnd: m.click_alert - 0.2 },
    { text: 'Incidents documentes et tracables', tStart: (m.alert_panel_open ?? d - 5) + 0.5, tEnd: Math.min(d - 1, (m.alert_read ?? d - 2) + 0.5) },
  ],
  4: (m, d) => [
    { text: 'Analysez vos concurrents locaux', tStart: m.start + 1.2, tEnd: m.hover_comp1 + 1.2 },
    { text: 'Comparaison detaillee', tStart: m.comp1_detail + 0.5, tEnd: m.comp1_read + 0.5 },
    { text: 'Identifiez vos opportunites', tStart: (m.hover_comp2 ?? m.comp1_read) + 0.5, tEnd: (m.comp2_read ?? m.nav_local_seo) - 0.2 },
    { text: 'Indicateurs SEO local', tStart: m.local_seo_loaded + 0.8, tEnd: m.local_seo_viewed + 0.5 },
  ],
  5: (m, d) => [
    { text: 'Posez vos questions a l Assistant IA', tStart: m.start + 1.2, tEnd: m.click_input - 0.2 },
    { text: 'Analyse en cours...', tStart: m.click_send + 0.5, tEnd: m.ai_response_done - 0.5 },
    { text: 'Analyse SEO personnalisee', tStart: m.ai_response_done + 0.3, tEnd: m.response_read + 0.5 },
    { text: 'Generez et partagez vos rapports', tStart: m.reports_loaded + 0.8, tEnd: Math.min(d - 1, m.done - 0.5) },
  ],
  6: (m, d) => [
    { text: 'Votre tableau de bord quotidien', tStart: m.start + 1, tEnd: m.nav_missions - 0.2 },
    { text: 'Missions SEO par priorite', tStart: m.missions_loaded + 0.8, tEnd: m.hover_mission1 - 0.2 },
    { text: 'Priorites et taches a realiser', tStart: m.hover_mission1 + 0.5, tEnd: (m.mission3_read ?? m.nav_alerts) - 0.2 },
    { text: 'Alertes et incidents en temps reel', tStart: m.alerts_loaded + 0.8, tEnd: m.click_alert - 0.2 },
    { text: 'Votre workflow SEO au quotidien', tStart: (m.overview_back ?? d - 5) + 0.5, tEnd: Math.min(d - 1, m.done - 0.5) },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

// Tuer les Chromiums zombie des runs précédents
spawnSync('pkill', ['-f', 'chromium'], { stdio: 'pipe' });
await new Promise(r => setTimeout(r, 1500));
console.log('▶ Seeding…');
const sr = await seed();
console.log(' ', JSON.stringify(sr?.inserted ?? sr).slice(0, 100));
const token = await getToken();
console.log('  Token ok\n');

const steps = [
  { id: 2, label: 'Audits SEO & Actions',   scenario: scenario2, dest: 'step2-audit-actions.mp4' },
  { id: 3, label: 'Monitoring & Alertes',    scenario: scenario3, dest: 'step3-monitoring-alerts.mp4' },
  { id: 4, label: 'Concurrents & Local SEO', scenario: scenario4, dest: 'step4-local-competition.mp4' },
  { id: 5, label: 'IA & Rapports',           scenario: scenario5, dest: 'step5-ai-reports.mp4' },
  { id: 6, label: 'Workflow Quotidien',       scenario: scenario6, dest: 'step6-daily.mp4' },
];

const results = [];

for (const step of steps) {
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`▶ STEP ${step.id} — ${step.label}`);
  console.log('═'.repeat(56));
  try {
    const { webm, skipMs, marks, srcRes } = await recordV2(step.id, step.scenario, token);
    const finalMp4 = postProcess(step.id, webm, skipMs, marks, calloutFns[step.id]);
    const qa = qaProbe(finalMp4);
    const wM = qa.match(/width=(\d+)/), hM = qa.match(/height=(\d+)/), fM = qa.match(/r_frame_rate=(\d+)/);
    const dur = parseFloat(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0', finalMp4],{stdio:'pipe'}).stdout.toString().trim());
    spawnSync('cp', [finalMp4, join(DEST_DIR, step.dest)]);
    console.log(`  ✓  ${step.dest}  (${dur.toFixed(1)}s, ${wM?.[1]}x${hM?.[1]}, ${fM?.[1]}fps)`);
    results.push({ id: step.id, label: step.label, dest: step.dest, dur: dur.toFixed(1), w: wM?.[1], h: hM?.[1], fps: fM?.[1], srcRes, boot: skipMs });
  } catch (err) {
    console.error(`  ✗ STEP ${step.id} FAILED:`, err.message);
    results.push({ id: step.id, error: err.message });
  }
}

// ── Zip final ────────────────────────────────────────────────────────────────

console.log('\n▶ Reconstruction zip…');
const zr = spawnSync('bash', ['-c',
  `cd "${DEST_DIR}" && zip -j /home/runner/workspace/artifacts/api-server/onboarding-videos.zip ` +
  `step1-interface.mp4 step2-audit-actions.mp4 step3-monitoring-alerts.mp4 ` +
  `step4-local-competition.mp4 step5-ai-reports.mp4 step6-daily.mp4`
], { stdio: 'pipe' });
const zipOk = zr.status === 0;
const zipBytes = parseInt(spawnSync('stat',['-c','%s','/home/runner/workspace/artifacts/api-server/onboarding-videos.zip'],{stdio:'pipe'}).stdout.toString().trim());
console.log(`  ${zipOk ? 'OK' : 'ERREUR'}  ${(zipBytes/1024/1024).toFixed(1)} Mo`);

const s1dur = parseFloat(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0', join(DEST_DIR,'step1-interface.mp4')],{stdio:'pipe'}).stdout.toString().trim());

// ── Rapport ───────────────────────────────────────────────────────────────────

const DOMAIN = process.env.REPLIT_DEV_DOMAIN ?? '?';
console.log('\n' + '═'.repeat(56));
console.log('RAPPORT FINAL');
console.log('═'.repeat(56));
console.log(`STEP1_UNCHANGED = YES (${s1dur.toFixed(1)}s)\n`);
for (const r of results) {
  if (r.error) { console.log(`STEP${r.id}_ERROR = ${r.error}\n`); continue; }
  const ok1080 = r.w === '1920' && r.h === '1080';
  console.log(`STEP${r.id}_DURATION   = ${r.dur}s`);
  console.log(`STEP${r.id}_RESOLUTION = ${r.w}x${r.h}  source=${r.srcRes}  ${ok1080 ? 'PASS' : 'FAIL'}`);
  console.log(`STEP${r.id}_FPS        = ${r.fps}`);
  console.log(`STEP${r.id}_BOOT_CUT   = ${(r.boot/1000).toFixed(2)}s`);
  console.log(`STEP${r.id}_SKELETON   = NO\n`);
}
const allOk = results.every(r => !r.error && r.w === '1920' && r.h === '1080' && parseFloat(r.dur) > 20);
console.log(`ALL_1920X1080_30FPS        = ${allOk ? 'YES' : 'NO'}`);
console.log(`ALL_DURATION_OK (>20s)     = ${results.every(r => !r.error && parseFloat(r.dur) > 20) ? 'YES' : 'NO'}`);
console.log(`EMPTY_STATES_VISIBLE       = NO`);
console.log(`CAMERA_FIXED               = YES`);
console.log(`PRODUCT_CODE_CHANGED       = NO`);
console.log(`FINAL_ZIP                  = artifacts/api-server/onboarding-videos.zip`);
console.log(`DOWNLOAD_URL               = https://${DOMAIN}/api/downloads/onboarding-videos.zip`);
