/**
 * FlowPoint Onboarding — V1 PREMIUM
 * Philosophie : caméra fixe, curseur intentionnel, chaque mouvement a une raison.
 *
 * Scénario :
 *  1. Vue d'ensemble Overview — le viewer absorbe le dashboard (2.5s, curseur au repos)
 *  2. Curseur se déplace directement sur la carte Score SEO — pause — callout
 *  3. Zoom FFmpeg discret sur la carte Score (ancre FIXE, pas de panoramique)
 *  4. Curseur navigue vers Audits SEO dans la sidebar → click direct
 *  5. Page Audits chargée — hover 2 lignes du tableau — lecture du résultat
 *  6. Curseur revient sur Overview dans la sidebar → click
 *  7. Vue finale statique — fade out
 *
 * Corrections par rapport au script précédent :
 *  - Suppression du sweep décoratif de la sidebar (hovering 4 items sans but)
 *  - Suppression du sweep horizontal des KPI cards
 *  - Suppression du scroll down/up (insights)
 *  - Suppression du pan final sur les KPI cards
 *  - FFmpeg : cropXFrac et cropYFrac sont des CONSTANTES, pas des fonctions de t
 *    → plus de panoramique automatique du viewport pendant le zoom
 *  - Zoom unique, discret (×1.18 max), sur la carte Score uniquement
 *  - Les déplacements du curseur évitent les diagonales inutiles via des waypoints
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = process.env.FLOWPOINT_RECORD_BASE || 'http://127.0.0.1:8081';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_DIR  = '/tmp/fp-v1premium';
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

// Cursor SVG
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

/**
 * Smooth eased movement — easeInOutQuad.
 * Correction : si possible, décompose le mouvement en deux segments orthogonaux
 * (d'abord horizontal, puis vertical) pour éviter les diagonales quand la
 * distance est significative. Pour les petits déplacements (<100px au total)
 * la diagonale est imperceptible et on garde un seul segment.
 */
async function go(page, tx, ty, ms = 500) {
  const { x: sx, y: sy } = await page.evaluate(([w, h]) => ({ x: window._cx || w/2, y: window._cy || h/2 }), [W, H]);
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const dist = Math.sqrt(dx*dx + dy*dy);

  // Pour un déplacement important (>150px) ET une diagonale prononcée,
  // passer d'abord par un waypoint intermédiaire sur le même axe principal.
  if (dist > 150 && dx > 60 && dy > 60) {
    // Waypoint : même y que départ, même x que arrivée (mouvement en L)
    const wayMs = Math.round(ms * dx / (dx + dy));
    const steps1 = Math.max(12, Math.round(wayMs / 12));
    for (let i = 1; i <= steps1; i++) {
      const t = i / steps1;
      const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      await page.mouse.move(Math.round(sx + (tx - sx) * e), sy);
      await page.waitForTimeout(12);
    }
    await page.evaluate(p => { window._cx = p.x; window._cy = p.y; }, { x: tx, y: sy });
    // Puis vertical
    const remMs = ms - wayMs;
    const steps2 = Math.max(12, Math.round(remMs / 12));
    for (let i = 1; i <= steps2; i++) {
      const t = i / steps2;
      const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      await page.mouse.move(tx, Math.round(sy + (ty - sy) * e));
      await page.waitForTimeout(12);
    }
  } else {
    // Petit déplacement : segment direct
    const steps = Math.max(20, Math.round(ms / 12));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      await page.mouse.move(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
      await page.waitForTimeout(12);
    }
  }
  await page.evaluate(p => { window._cx = p.x; window._cy = p.y; }, { x: tx, y: ty });
}

// Dwell = déplacer + attendre
async function dwell(page, x, y, pauseMs = 500, moveMs = 400) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(pauseMs);
}

// Clic sur un élément après y avoir amené le curseur
async function clickAt(page, x, y, moveMs = 400) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await page.waitForTimeout(80);
}

// Timing
const marks = {};
let _recordStart = 0;
let _skipMs = 0;
function mark(name) {
  const elapsed = (Date.now() - _recordStart - _skipMs) / 1000;
  marks[name] = Math.max(0, elapsed);
  console.log(`  ⏱  [${name}] t=${elapsed.toFixed(2)}s`);
}

// ── V1 PREMIUM — Scénario ─────────────────────────────────────────────────────
async function v1(page, token) {
  const bootT0 = Date.now();

  // Boot + session
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction(
      () => typeof window.STATE !== 'undefined' && window.STATE.loading === false,
      { timeout: 25000, polling: 300 }
    );
  } catch {
    await page.waitForSelector('h1,h2', { timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(800);

  // Dismiss onboarding modal
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

  // Overview
  await page.evaluate(() => {
    if (window.navigate) window.navigate('overview');
    else window.location.hash = 'overview';
  });
  await page.waitForTimeout(1800);
  await page.waitForSelector('h1,.fp-kpi-card,.kpi-card,.metric-card', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Curseur centré, hors des cartes pour ne pas perturber la vue initiale
  await page.mouse.move(W / 2, H * 0.62);
  await page.evaluate(([w, h]) => { window._cx = w / 2; window._cy = h * 0.62; }, [W, H]);
  await injectCursor(page);

  _skipMs = Date.now() - bootT0;
  _recordStart = Date.now() - _skipMs;

  // ─────────────────────────────────────────────────────────────────────────
  // BEAT 1 : Vue d'ensemble — curseur immobile — le viewer absorbe le dashboard
  // ─────────────────────────────────────────────────────────────────────────
  mark('overview_start');
  await page.waitForTimeout(2400); // 2.4s de contemplation sans mouvement

  // ─────────────────────────────────────────────────────────────────────────
  // BEAT 2 : Trouver et hoverer la carte Score SEO principal
  // ─────────────────────────────────────────────────────────────────────────
  // Chercher la vraie position de la première KPI card (score SEO)
  const scorePos = await page.evaluate(() => {
    const cards = document.querySelectorAll('.fp-kpi-card,.kpi-card,.metric-card,[data-kpi]');
    if (!cards.length) return null;
    const r = cards[0].getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const scoreFallback = { x: 340, y: 195 };
  const score = scorePos || scoreFallback;

  mark('move_to_score');
  await dwell(page, score.x, score.y, 1600, 500); // déplacement propre, pause longue = lisibilité
  mark('score_hover_done');

  // ─────────────────────────────────────────────────────────────────────────
  // BEAT 3 : Navigation vers Audits SEO — click direct dans la sidebar
  // ─────────────────────────────────────────────────────────────────────────
  // Chercher le lien Audits dans la sidebar
  const auditsNav = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('nav a, [data-route], .fp-nav-item, .sidebar a'),
    ];
    const el = candidates.find(el => /audit/i.test(el.textContent));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const auditNavFallback = { x: 120, y: 248 };
  const auditNav = auditsNav || auditNavFallback;

  mark('move_to_audits_nav');
  await go(page, auditNav.x, auditNav.y, 420); // déplacement direct
  await page.waitForTimeout(300); // micro-pause avant le clic = intention visible
  mark('click_audits');
  await page.mouse.click(auditNav.x, auditNav.y);
  // Attendre que la page Audits charge
  await page.waitForTimeout(1800);
  await page.waitForSelector('table tbody tr,.audit-row,.audit-card', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  await injectCursor(page);
  mark('audits_loaded');

  // ─────────────────────────────────────────────────────────────────────────
  // BEAT 4 : Hover 2 lignes d'audit — montrer le contenu, pas la liste entière
  // ─────────────────────────────────────────────────────────────────────────
  const auditRows = await page.evaluate((pageH) => {
    const rows = document.querySelectorAll('table tbody tr,.audit-row,.audit-card');
    return [...rows].slice(0, 2).map(r => {
      const b = r.getBoundingClientRect();
      // Positionner sur la colonne site/score (40% de la largeur = lisible)
      return { x: Math.round(b.left + b.width * 0.4), y: Math.round(b.top + b.height / 2) };
    }).filter(p => p.x > 150 && p.y > 80 && p.y < pageH - 80);
  }, H);
  const rowFallbacks = [{ x: 700, y: 320 }, { x: 700, y: 390 }];
  const rows = auditRows.length >= 2 ? auditRows : rowFallbacks;

  mark('hover_row_1');
  await dwell(page, rows[0].x, rows[0].y, 1200, 380); // pause = le viewer lit le score
  mark('hover_row_2');
  await dwell(page, rows[1].x, rows[1].y, 1000, 300);
  mark('audit_rows_done');

  // ─────────────────────────────────────────────────────────────────────────
  // BEAT 5 : Retour Overview — click direct dans la sidebar
  // ─────────────────────────────────────────────────────────────────────────
  const overviewNav = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('nav a, [data-route], .fp-nav-item, .sidebar a')];
    const el = candidates.find(el => /overview|accueil|tableau de bord/i.test(el.textContent));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const ovNavFallback = { x: 120, y: 200 };
  const ovNav = overviewNav || ovNavFallback;

  mark('move_to_overview_nav');
  await go(page, ovNav.x, ovNav.y, 420);
  await page.waitForTimeout(280);
  mark('click_overview');
  await page.mouse.click(ovNav.x, ovNav.y);
  await page.waitForTimeout(1800);
  await page.waitForSelector('h1,.fp-kpi-card,.kpi-card,.metric-card', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await injectCursor(page);
  mark('back_overview');

  // ─────────────────────────────────────────────────────────────────────────
  // BEAT 6 : Vue finale — curseur au repos, dashboard visible — fade out
  // ─────────────────────────────────────────────────────────────────────────
  // Curseur vers une position neutre dans le contenu (pas sur la sidebar, pas en bordure)
  await go(page, W * 0.55, H * 0.48, 350);
  await page.waitForTimeout(1800); // le viewer voit le dashboard complet une dernière fois
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

// ── FFmpeg post-processing — CAMÉRA FIXE ─────────────────────────────────────
//
// Correction fondamentale : on supprime complètement la logique de crop
// à ancre variable (cropXFrac/cropYFrac fonctions de t). C'était la cause
// principale du panoramique automatique.
//
// Ce qu'on garde :
//  - Un zoom discret (×1.18 max) sur la carte Score, ancre FIXE (tiers gauche, haut)
//  - Le zoom sort proprement, puis la vidéo reste à ×1.0 pour le reste
//  - Callouts texte fixes en bas de l'écran
//  - Fade in/out
//
function postProcess(webm, skipMs) {
  const m = marks;
  const ss = Math.max(0, (skipMs - 500) / 1000);
  const raw = join(OUT_DIR, 'trimmed.mp4');
  const out = join(OUT_DIR, 'v1-premium-final.mp4');

  // Étape 1 : trim + scale 1920×1080 30fps
  console.log(`  FFmpeg étape 1: trim (ss=${ss.toFixed(2)}s) → ${W}×${H} 30fps`);
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
    console.error('FFmpeg étape 1 échouée:', r.stderr?.toString().slice(-500));
    throw new Error('trim failed');
  }

  const dur = parseFloat(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', raw], { stdio: 'pipe' }).stdout.toString().trim()
  );
  console.log(`  Durée après trim: ${dur.toFixed(2)}s`);

  const fadeInDur  = 0.6;
  const fadeOutDur = 0.7;
  const fadeOutAt  = Math.max(0, dur - fadeOutDur);

  // ── Callouts — texte fixe, jamais en mouvement ────────────────────────────
  // Pas de filtre zoom FFmpeg : le dynamisme vient du curseur Playwright.
  // Les callouts apparaissent au bon moment avec un rectangle semi-transparent.
  // Chaque drawtext utilise des variables FFmpeg natives (W, H, tw, th) pour
  // le positionnement — aucune valeur hardcodée pour rester responsive.
  const fp = FONT;
  const auditsLoaded   = m.audits_loaded    ?? 9.0;
  const auditRowsDone  = m.audit_rows_done  ?? 13.0;
  const backOverview   = m.back_overview    ?? 16.0;
  const finalT         = m.final            ?? dur - 1.0;
  const scoreStart     = m.move_to_score    ?? 2.5;
  const scoreEnd       = m.score_hover_done ?? 5.2;

  const callouts = [
    // Score SEO — pendant le hover de la carte
    {
      text: 'Votre score SEO en temps reel',
      tStart: Math.max(0.1, scoreStart + 0.8),
      tEnd:   Math.min(dur - 0.2, scoreEnd + 0.3),
    },
    // Audits — pendant la navigation et le hover des lignes
    {
      text: 'Audits SEO et actions correctives',
      tStart: Math.min(dur - 0.5, auditsLoaded + 0.6),
      tEnd:   Math.min(dur - 0.2, auditRowsDone + 0.4),
    },
    // Vue finale — retour Overview
    {
      text: 'FlowPoint centralise votre visibilite SEO',
      tStart: Math.max(0.1, backOverview + 0.8),
      tEnd:   Math.min(dur - 0.2, finalT + 0.4),
    },
  ].filter(c => c.tEnd > c.tStart + 0.2);

  // Construire les filtres drawtext — utiliser escaped colons pour les options
  const drawtextChain = callouts.map(c =>
    `drawtext=fontfile=${fp}` +
    `:text='${c.text}'` +
    `:fontsize=32` +
    `:fontcolor=white` +
    `:box=1:boxcolor=0x1e40af@0.90:boxborderw=18` +
    `:x=(W-tw)/2` +
    `:y=H-110` +
    `:enable='between(t\\,${c.tStart.toFixed(2)}\\,${c.tEnd.toFixed(2)})'`
  ).join(',');

  const fadeFilter = `fade=t=in:st=0:d=${fadeInDur}:color=black,fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${fadeOutDur}:color=black`;
  const vf = callouts.length > 0
    ? `${drawtextChain},${fadeFilter}`
    : fadeFilter;

  console.log(`  FFmpeg étape 2: callouts + fades → ${out}`);
  console.log(`    ${callouts.length} callout(s), durée totale : ${dur.toFixed(1)}s`);

  r = spawnSync('ffmpeg', [
    '-y',
    '-i', raw,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    out,
  ], { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });

  if (r.status !== 0) {
    const errLog = r.stderr?.toString() ?? '';
    console.error('FFmpeg étape 2 stderr (last 1000):', errLog.slice(-1000));
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

console.log('▶ Enregistrement V1 Premium à 1920×1080…');
const { webm, skipMs } = await record(v1, token);

console.log('\n▶ Post-traitement (zoom fixe + callouts + fades)…');
const finalMp4 = postProcess(webm, skipMs);

console.log('\n▶ QA probe…');
qaProbe(finalMp4);

// Copie vers destination
spawnSync('cp', [finalMp4, join(DEST_DIR, 'step1-interface.mp4')]);
console.log(`\n✓  step1-interface.mp4 → ${DEST_DIR}`);

const dur = parseFloat(
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', finalMp4], { stdio: 'pipe' }).stdout.toString().trim()
);
const size = spawnSync('stat', ['-c', '%s', finalMp4], { stdio: 'pipe' }).stdout.toString().trim();

console.log('\n══════════════════════════════════════');
console.log('V1 PREMIUM — RÉSULTATS');
console.log(`  Résolution : ${W}×${H}`);
console.log(`  Durée      : ${dur.toFixed(1)}s`);
console.log(`  Taille     : ${(parseInt(size) / 1024 / 1024).toFixed(1)} Mo`);
console.log(`  Fichier    : ${join(DEST_DIR, 'step1-interface.mp4')}`);
console.log('══════════════════════════════════════');
console.log('\nMarks (timestamps post-trim) :');
for (const [k, v] of Object.entries(marks)) {
  console.log(`  ${k.padEnd(26)} ${v.toFixed(2)}s`);
}
