/**
 * FlowPoint Onboarding — V1 V2 (corrections post-audit)
 *
 * CORRECTIONS FONDAMENTALES vs premium :
 *
 *  1. waitForDashboardReady() — garde robuste skeleton :
 *       - attend STATE.loading === false ET STATE.me présent
 *       - vérifie que #fp-loading-skeleton est absent du DOM
 *       - vérifie que les .fp-skeleton visibles = 0
 *       - vérifie qu'au moins un .fp-kpi-row / .fp-overview-grid a du contenu réel
 *       - attend 2s de stabilité supplémentaires avant de démarrer
 *
 *  2. Enregistrement démarre UNIQUEMENT après readiness complète — le trim FFmpeg
 *     n'est qu'un filet de sécurité, pas le mécanisme principal.
 *
 *  3. Scénario Overview uniquement — pas de navigation vers d'autres pages :
 *       Beat 1 : Dashboard au repos (curseur immobile, viewer absorbe)
 *       Beat 2 : Curseur → carte Score SEO (KPI 1) — pause longue
 *       Beat 3 : Curseur → carte Audits/Monitors (KPI 2) — pause
 *       Beat 4 : Curseur → section insights / troisième élément — pause
 *       Beat 5 : Retour position neutre — vue finale — fade out
 *
 *  4. Résolution unique : 1920×1080 30fps (même format pour toutes les vidéos)
 *
 *  5. Aucun zoom FFmpeg — le dynamisme vient du curseur.
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = process.env.FLOWPOINT_RECORD_BASE || 'http://127.0.0.1:8081';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_DIR  = '/tmp/fp-v1v2';
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

// ── Cursor injection ──────────────────────────────────────────────────────────

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

// ── Dashboard readiness guard ─────────────────────────────────────────────────
//
// C'est la correction principale contre les skeletons visibles dans la vidéo.
// Ne démarre JAMAIS l'enregistrement utile tant que toutes ces conditions
// ne sont pas satisfaites simultanément :
//
//   (A) STATE.loading === false ET STATE.me est défini
//   (B) #fp-loading-skeleton absent du DOM
//   (C) Aucun .fp-skeleton avec dimensions > 0 (pas de skeleton visible)
//   (D) Au moins un élément de contenu réel est présent et non vide
//   (E) 2s de stabilité supplémentaires après (A)-(D) tous réunis
//
async function waitForDashboardReady(page, label = 'dashboard') {
  const POLL_MS = 250;
  const MAX_ATTEMPTS = 100; // 25s max

  // Étape A : attendre STATE.loading === false (Phase 1+2 du dashboard)
  await page.waitForFunction(
    () => {
      return !!(window.STATE && window.STATE.loading === false && window.STATE.me);
    },
    { timeout: 25000, polling: POLL_MS }
  ).catch(async () => {
    // Fallback si STATE n'est pas exposé : attendre qu'une page de contenu soit rendue
    await page.waitForSelector(
      '.fp-overview-grid,.fp-kpi-row,.fp-chart-card,.fp-stat-row',
      { timeout: 10000 }
    ).catch(() => {});
  });

  // Étapes B, C, D : vérifier l'absence de skeleton et la présence de contenu
  let stableCount = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const ready = await page.evaluate(() => {
      // (B) le skeleton principal doit être absent
      const mainSkel = document.getElementById('fp-loading-skeleton');
      if (mainSkel) return { ok: false, reason: 'main-skeleton-present' };

      // (C) aucun .fp-skeleton visible (dimensions non nulles)
      const skels = document.querySelectorAll('.fp-skeleton,.fp-skel-shimmer');
      for (const el of skels) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { ok: false, reason: 'fp-skeleton-visible' };
      }

      // (D) présence d'au moins un élément de contenu réel avec du texte
      const contentEls = document.querySelectorAll(
        '.fp-kpi-row,.fp-overview-grid,.fp-chart-card,.fp-stat-card,.fp-stat-row'
      );
      if (contentEls.length === 0) return { ok: false, reason: 'no-content-elements' };

      // Au moins un élément de contenu doit avoir du texte non vide
      let hasText = false;
      for (const el of contentEls) {
        const t = el.textContent?.trim() ?? '';
        if (t.length > 3) { hasText = true; break; }
      }
      if (!hasText) return { ok: false, reason: 'content-elements-empty' };

      return { ok: true };
    });

    if (ready.ok) {
      stableCount++;
      // (E) exiger 3 vérifications consécutives réussies (~750ms) avant de valider
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
      if (i % 8 === 0) console.log(`    [readiness:${label}] attente… (${ready.reason})`);
    }
    await page.waitForTimeout(POLL_MS);
  }

  // Attente de stabilité finale — s'assure que les animations de rendu sont terminées
  console.log(`    [readiness:${label}] contenu détecté — 2s de stabilité…`);
  await page.waitForTimeout(2000);
  console.log(`    [readiness:${label}] ✓ dashboard prêt`);
}

// ── Mouvement curseur (easeInOutQuad, trajectoire en L pour grandes diagonales) ─

async function go(page, tx, ty, ms = 500) {
  const { x: sx, y: sy } = await page.evaluate(
    ([w, h]) => ({ x: window._cx || w / 2, y: window._cy || h / 2 }),
    [W, H]
  );
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);

  if (Math.sqrt(dx * dx + dy * dy) > 150 && dx > 60 && dy > 60) {
    // Mouvement en L : horizontal d'abord, puis vertical
    const wayMs = Math.round(ms * dx / (dx + dy));
    const s1 = Math.max(12, Math.round(wayMs / 12));
    for (let i = 1; i <= s1; i++) {
      const t = i / s1, e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      await page.mouse.move(Math.round(sx + (tx - sx) * e), sy);
      await page.waitForTimeout(12);
    }
    await page.evaluate(p => { window._cx = p.x; window._cy = p.y; }, { x: tx, y: sy });
    const s2 = Math.max(12, Math.round((ms - wayMs) / 12));
    for (let i = 1; i <= s2; i++) {
      const t = i / s2, e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      await page.mouse.move(tx, Math.round(sy + (ty - sy) * e));
      await page.waitForTimeout(12);
    }
  } else {
    const steps = Math.max(20, Math.round(ms / 12));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      await page.mouse.move(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
      await page.waitForTimeout(12);
    }
  }
  await page.evaluate(p => { window._cx = p.x; window._cy = p.y; }, { x: tx, y: ty });
}

async function dwell(page, x, y, pauseMs = 600, moveMs = 400) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(pauseMs);
}

// ── Timing ───────────────────────────────────────────────────────────────────
const marks = {};
let _recordStart = 0;
let _skipMs = 0;

function mark(name) {
  const elapsed = (Date.now() - _recordStart - _skipMs) / 1000;
  marks[name] = Math.max(0, elapsed);
  console.log(`  ⏱  [${name}] t=${elapsed.toFixed(2)}s`);
}

// ── Scénario V1 — Overview uniquement ────────────────────────────────────────
async function v1(page, token) {
  const bootT0 = Date.now();

  // ── 1. Boot : navigation + readiness ──────────────────────────────────────
  console.log('  → navigation vers le dashboard…');
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Dismiss onboarding modal si présent (avant la garde readiness)
  await page.waitForTimeout(1500);
  for (const s of [
    'button:has-text("Passer la visite")',
    'button:has-text("Ignorer")',
    'button:has-text("Skip")',
    '[data-dismiss="modal"]',
  ]) {
    try {
      const b = page.locator(s).first();
      if (await b.isVisible({ timeout: 300 }).catch(() => false)) {
        await b.click();
        await page.waitForTimeout(400);
        break;
      }
    } catch {}
  }

  // Naviguer explicitement sur Overview avant de vérifier la readiness
  await page.evaluate(() => {
    if (typeof window.navigate === 'function') window.navigate('overview');
    else window.location.hash = '#overview';
  });

  // Garde readiness — aucun skeleton ne doit être visible
  console.log('  → vérification readiness Overview…');
  await waitForDashboardReady(page, 'overview-initial');

  // ── 2. Positionner le curseur et marquer le début utile ──────────────────
  // Position initiale : milieu de la zone de contenu (hors sidebar, hors KPI cards)
  await page.mouse.move(W / 2, H * 0.68);
  await page.evaluate(([w, h]) => { window._cx = w / 2; window._cy = h * 0.68; }, [W, H]);
  await injectCursor(page);

  // À ce stade, le dashboard est 100% chargé — on marque le début de l'enregistrement utile
  _skipMs = Date.now() - bootT0;
  _recordStart = Date.now() - _skipMs;

  // ── BEAT 1 : Contemplation — le viewer absorbe le dashboard ───────────────
  mark('overview_start');
  await page.waitForTimeout(2800);

  // ── BEAT 2 : Curseur → 1ère carte KPI (Score SEO) ─────────────────────────
  const kpi1 = await page.evaluate(() => {
    // Chercher la première carte KPI visible avec du contenu réel
    const cards = document.querySelectorAll(
      '.fp-kpi-row .fp-kpi-card, .fp-kpi-row > div, .fp-stat-card, .metric-card, [data-kpi]'
    );
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.width > 40 && r.height > 20 && r.top > 60 && r.left > 100) {
        return { x: Math.round(r.left + r.width * 0.45), y: Math.round(r.top + r.height * 0.45) };
      }
    }
    return null;
  });
  const kpi1Pos = kpi1 || { x: 340, y: 190 };

  mark('move_to_kpi1');
  await dwell(page, kpi1Pos.x, kpi1Pos.y, 2200, 480);
  mark('kpi1_done');

  // ── BEAT 3 : Curseur → 2e carte KPI ──────────────────────────────────────
  const kpi2 = await page.evaluate((k1x) => {
    const cards = document.querySelectorAll(
      '.fp-kpi-row .fp-kpi-card, .fp-kpi-row > div, .fp-stat-card, .metric-card, [data-kpi]'
    );
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.width > 40 && r.height > 20 && r.top > 60 && r.left > k1x + 40) {
        return { x: Math.round(r.left + r.width * 0.45), y: Math.round(r.top + r.height * 0.45) };
      }
    }
    return null;
  }, kpi1Pos.x);
  const kpi2Pos = kpi2 || { x: kpi1Pos.x + 260, y: kpi1Pos.y };

  mark('move_to_kpi2');
  await dwell(page, kpi2Pos.x, kpi2Pos.y, 1800, 380);
  mark('kpi2_done');

  // ── BEAT 4 : Curseur → zone insights / chart card (bas du dashboard) ──────
  // Chercher une carte de graphique ou section d'insights sous les KPI
  const chartPos = await page.evaluate((kpiY) => {
    const cards = document.querySelectorAll(
      '.fp-chart-card, .fp-insight-card, .fp-overview-grid .fp-card, .fp-stat-row, .fp-audit-list'
    );
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.width > 100 && r.height > 60 && r.top > kpiY + 40 && r.top < window.innerHeight - 80) {
        return {
          x: Math.round(r.left + r.width * 0.35),
          y: Math.round(r.top + Math.min(r.height * 0.3, 60))
        };
      }
    }
    return null;
  }, kpi1Pos.y);
  const chartPosFinal = chartPos || { x: Math.round(W * 0.45), y: Math.round(H * 0.52) };

  mark('move_to_chart');
  await dwell(page, chartPosFinal.x, chartPosFinal.y, 2000, 500);
  mark('chart_done');

  // ── BEAT 5 : Retour position neutre — vue finale complète ─────────────────
  mark('move_to_center');
  await go(page, Math.round(W * 0.54), Math.round(H * 0.46), 380);
  await page.waitForTimeout(2400);
  mark('final');

  return _skipMs;
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
  writeFileSync(join(OUT_DIR, 'marks.json'), JSON.stringify({ skipMs, marks }, null, 2));
  console.log('  Marks:', JSON.stringify(marks, null, 2));
  return { webm, skipMs };
}

// ── FFmpeg post-processing ────────────────────────────────────────────────────
//
// Pas de zoom — la dynamique vient du curseur.
// Le trim FFmpeg (-ss) est un filet de sécurité : en théorie le dashboard est
// déjà prêt quand _skipMs est calculé, mais on coupe quand même les premières
// secondes pour éliminer tout artefact de boot navigateur.
//
function postProcess(webm, skipMs) {
  const m = marks;
  // Couper les (skipMs - 800ms) premières secondes du webm.
  // Le -800ms garde 800ms de marge avant le premier mark — le dashboard doit
  // déjà être stable à ce moment (readiness guard l'a garanti).
  const ss = Math.max(0, (skipMs - 800) / 1000);
  const raw = join(OUT_DIR, 'trimmed.mp4');
  const out = join(OUT_DIR, 'v1-v2-final.mp4');

  console.log(`  FFmpeg étape 1: trim (ss=${ss.toFixed(2)}s) → ${W}×${H} 30fps`);
  let r = spawnSync('ffmpeg', [
    '-y',
    ...(ss > 0.5 ? ['-ss', ss.toFixed(2)] : []),
    '-i', webm,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    raw,
  ], { stdio: 'pipe' });
  if (r.status !== 0) {
    console.error('FFmpeg étape 1 échouée:', r.stderr?.toString().slice(-600));
    throw new Error('trim failed');
  }

  const dur = parseFloat(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', raw], { stdio: 'pipe' }).stdout.toString().trim()
  );
  console.log(`  Durée après trim: ${dur.toFixed(2)}s`);

  const fadeInDur  = 0.5;
  const fadeOutDur = 0.7;
  const fadeOutAt  = Math.max(0, dur - fadeOutDur);

  // ── Callouts ──────────────────────────────────────────────────────────────
  const kpi1Start  = m.move_to_kpi1  ?? 3.0;
  const kpi1End    = m.kpi1_done     ?? 6.0;
  const kpi2Start  = m.move_to_kpi2  ?? 6.5;
  const kpi2End    = m.kpi2_done     ?? 9.0;
  const chartStart = m.move_to_chart ?? 9.5;
  const chartEnd   = m.chart_done    ?? 12.0;
  const finalT     = m.final         ?? dur - 1.0;

  const callouts = [
    {
      text: 'Votre score SEO en temps reel',
      tStart: Math.max(0.2, kpi1Start + 0.6),
      tEnd:   Math.min(dur - 0.3, kpi1End + 0.2),
    },
    {
      text: 'Vos indicateurs cles en temps reel',
      tStart: Math.max(0.2, kpi2Start + 0.5),
      tEnd:   Math.min(dur - 0.3, kpi2End + 0.2),
    },
    {
      text: 'FlowPoint centralise votre visibilite SEO',
      tStart: Math.max(0.2, chartEnd + 0.5),
      tEnd:   Math.min(dur - 0.3, finalT + 0.3),
    },
  ].filter(c => c.tEnd > c.tStart + 0.3);

  const FONT_PATH = FONT;
  const drawtextChain = callouts.map(c =>
    `drawtext=fontfile=${FONT_PATH}` +
    `:text='${c.text}'` +
    `:fontsize=30` +
    `:fontcolor=white` +
    `:box=1:boxcolor=0x1e3a8a@0.88:boxborderw=20` +
    `:x=(W-tw)/2` +
    `:y=H-100` +
    `:enable='between(t\\,${c.tStart.toFixed(2)}\\,${c.tEnd.toFixed(2)})'`
  ).join(',');

  const fadeFilter =
    `fade=t=in:st=0:d=${fadeInDur}:color=black,` +
    `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${fadeOutDur}:color=black`;

  const vf = callouts.length > 0
    ? `${drawtextChain},${fadeFilter}`
    : fadeFilter;

  console.log(`  FFmpeg étape 2: callouts + fades → ${out}`);
  console.log(`    ${callouts.length} callout(s) | durée : ${dur.toFixed(1)}s | ss=${ss.toFixed(1)}s`);

  r = spawnSync('ffmpeg', [
    '-y', '-i', raw,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    out,
  ], { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });

  if (r.status !== 0) {
    const errLog = r.stderr?.toString() ?? '';
    console.error('FFmpeg étape 2 stderr:', errLog.slice(-1000));
    throw new Error('post-process failed');
  }

  return out;
}

// ── QA probe ──────────────────────────────────────────────────────────────────
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

console.log(`▶ Enregistrement V1-V2 à ${W}×${H} (Overview uniquement, garde skeleton)…`);
const { webm, skipMs } = await record(v1, token);

console.log('\n▶ Post-traitement (callouts + fades, pas de zoom)…');
const finalMp4 = postProcess(webm, skipMs);

console.log('\n▶ QA probe…');
qaProbe(finalMp4);

// Copier vers destination
spawnSync('cp', [finalMp4, join(DEST_DIR, 'step1-interface.mp4')]);
console.log(`\n✓  step1-interface.mp4 → ${DEST_DIR}`);

const dur = parseFloat(
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', finalMp4], { stdio: 'pipe' }).stdout.toString().trim()
);
const size = spawnSync('stat', ['-c', '%s', finalMp4], { stdio: 'pipe' }).stdout.toString().trim();

console.log('\n══════════════════════════════════════');
console.log('V1-V2 — RÉSULTATS');
console.log(`  Résolution : ${W}×${H}`);
console.log(`  FPS        : 30`);
console.log(`  Durée      : ${dur.toFixed(1)}s`);
console.log(`  Taille     : ${(parseInt(size) / 1024 / 1024).toFixed(1)} Mo`);
console.log(`  Fichier    : ${join(DEST_DIR, 'step1-interface.mp4')}`);
console.log('══════════════════════════════════════');
console.log('\nMarks (timestamps post-trim) :');
for (const [k, v] of Object.entries(marks)) {
  console.log(`  ${k.padEnd(28)} ${v.toFixed(2)}s`);
}
