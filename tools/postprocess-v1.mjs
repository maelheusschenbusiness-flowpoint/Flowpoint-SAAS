/**
 * V1 pilot — post-processing only
 * Reads the already-recorded webm + marks.json, produces final 1920×1080 MP4.
 *
 * Approach: segment-based concat
 *   • Normal segments → 1920×1080 pass-through
 *   • Zoom A (KPI) → crop 1500×844 centered + scale 1920×1080 (1.28×)
 *   • Zoom B (audits) → crop 1574×886 centered + scale 1920×1080 (1.22×)
 *   • Each segment boundary has a 0.4s fade-out / fade-in (subtle blink zoom)
 *   • drawtext callouts in FlowPoint style
 *   • Global fade-in 0.8s, fade-out 0.8s
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT     = '/tmp/fp-v1pilot';
const DEST    = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const FONT    = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1920, H = 1080, FPS = 30;

mkdirSync(join(OUT, 'segs'), { recursive: true });

// ── Load raw webm ─────────────────────────────────────────────────────────────
const rawDir = join(OUT, 'raw');
const webms  = readdirSync(rawDir).filter(f => f.endsWith('.webm'));
if (!webms.length) throw new Error('No raw webm found in ' + rawDir);
const webm = join(rawDir, webms[0]);
console.log('Raw webm:', webm);

// ── Load marks ────────────────────────────────────────────────────────────────
const { skipMs, marks: raw_marks } = JSON.parse(readFileSync(join(OUT, 'marks.json'), 'utf8'));

// Offset: trim cuts (skipMs - 600ms) from start → boot ends at t=0.6 in trimmed video
// trimmed_t = raw_mark_elapsed + 0.6
const offset = (skipMs - (skipMs - 600)) / 1000; // = 0.6
const tm = name => Math.max(0, (raw_marks[name] ?? 0) + offset);

const dur_raw = parseFloat(spawnSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm,
], { stdio: 'pipe' }).stdout.toString().trim());
const trimStart = Math.max(0, (skipMs - 600) / 1000);
const dur_total = dur_raw - trimStart;
console.log(`Raw duration: ${dur_raw.toFixed(2)}s, trim at: ${trimStart.toFixed(2)}s, effective: ${dur_total.toFixed(2)}s`);

// ── Segment boundaries ────────────────────────────────────────────────────────
// Zoom A: KPI score focus  — 1.28× center zoom
const zA_start = Math.max(0.5, tm('kpi_score_focus') - 0.5);
const zA_end   = Math.min(dur_total, tm('kpi_score_done') + 0.8);

// Zoom B: Audit results — 1.22× center zoom (slightly less, audits table area)
const zB_start = Math.max(0, tm('audits_loaded') - 0.3);
const zB_end   = Math.min(dur_total, tm('audit_linger_done') + 0.8);

console.log(`\nZoom A: ${zA_start.toFixed(2)}s → ${zA_end.toFixed(2)}s (${(zA_end-zA_start).toFixed(2)}s)`);
console.log(`Zoom B: ${zB_start.toFixed(2)}s → ${zB_end.toFixed(2)}s (${(zB_end-zB_start).toFixed(2)}s)`);

// Segments: [startInTrimmed, endInTrimmed, 'normal'|'zoomA'|'zoomB']
const segs = [
  [0,         zA_start, 'normal'],
  [zA_start,  zA_end,   'zoomA'],
  [zA_end,    zB_start, 'normal'],
  [zB_start,  zB_end,   'zoomB'],
  [zB_end,    dur_total,'normal'],
].filter(([s, e]) => e - s > 0.1); // drop tiny segments

console.log('\nSegments:');
segs.forEach(([s, e, t]) => console.log(`  ${t.padEnd(8)} ${s.toFixed(2)}→${e.toFixed(2)}s  (${(e-s).toFixed(2)}s)`));

// ── FFmpeg helpers ────────────────────────────────────────────────────────────
function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-y', ...args], {
    stdio: 'pipe',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const e = r.stderr?.toString() ?? '';
    console.error(`FFmpeg [${label}] FAILED:\n${e.slice(-800)}`);
    throw new Error(`ffmpeg failed: ${label}`);
  }
  return r;
}

function probeDur(file) {
  return parseFloat(spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ], { stdio: 'pipe' }).stdout.toString().trim());
}

// ── Generate each segment ─────────────────────────────────────────────────────
const FADE = 0.35; // seconds for fade in/out at each segment boundary

function buildVf(type, dur) {
  const basePipe = [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${FPS}`,
  ];

  let zoom = '';
  if (type === 'zoomA') {
    // 1.28× center zoom: crop 1500×844 from center, scale to 1920×1080
    // crop x = (1920 - 1500)/2 = 210, y = (1080 - 844)/2 = 118
    zoom = `crop=1500:844:210:118,scale=${W}:${H}:flags=lanczos,fps=${FPS}`;
  } else if (type === 'zoomB') {
    // 1.22× center zoom: crop 1574×886 from center, scale to 1920×1080
    // crop x = (1920-1574)/2=173, y=(1080-886)/2=97
    zoom = `crop=1574:886:173:97,scale=${W}:${H}:flags=lanczos,fps=${FPS}`;
  }

  const baseChain = type === 'normal' ? basePipe.join(',') : zoom;

  // Add fade in/out within segment
  const fadePart = `fade=t=in:st=0:d=${FADE}:color=black,fade=t=out:st=${Math.max(0, dur - FADE).toFixed(3)}:d=${FADE}:color=black`;
  return `${baseChain},${fadePart}`;
}

const segFiles = [];
for (let i = 0; i < segs.length; i++) {
  const [ss_in_trimmed, ee_in_trimmed, type] = segs[i];
  const seg_ss = trimStart + ss_in_trimmed;  // position in raw webm
  const seg_dur = ee_in_trimmed - ss_in_trimmed;
  const segFile = join(OUT, 'segs', `seg${i}_${type}.mp4`);

  const vf = buildVf(type, seg_dur);
  console.log(`\n  Seg ${i} [${type}] ${seg_dur.toFixed(2)}s`);

  ff([
    '-ss', seg_ss.toFixed(3),
    '-t',  seg_dur.toFixed(3),
    '-i',  webm,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    segFile,
  ], `seg${i}`);

  const d = probeDur(segFile);
  console.log(`    → ${segFile} (${d.toFixed(2)}s)`);
  segFiles.push(segFile);
}

// ── Concatenate segments ──────────────────────────────────────────────────────
console.log('\n▶ Concatenating segments…');
const concatList = join(OUT, 'concat.txt');
writeFileSync(concatList, segFiles.map(f => `file '${f}'`).join('\n'));

const concatRaw = join(OUT, 'concat_raw.mp4');
ff([
  '-f', 'concat', '-safe', '0',
  '-i', concatList,
  '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  concatRaw,
], 'concat');

const concatDur = probeDur(concatRaw);
console.log(`  Concatenated: ${concatDur.toFixed(2)}s`);

// ── Add callouts + global fades ───────────────────────────────────────────────
console.log('\n▶ Adding callouts + global fade in/out…');

// Callout timestamps in the CONCATENATED (post-zoom) video
// After concatenation with fades, the segment durations are preserved (fades don't change duration)
// Callouts reference the same trimmed-time coordinates

const globalFadeIn  = 0.8;
const globalFadeOut = 0.8;
const fadeOutAt     = Math.max(0, concatDur - globalFadeOut);

// Helper: build drawtext for one callout
// text must not contain ' or \ characters → sanitize before use
function dt(text, enableStart, enableEnd, yPos = `H-118`) {
  const safeText = text.replace(/'/g, '').replace(/\\/g, '').replace(/&/g, 'et').replace(/é/g, 'e').replace(/è/g, 'e').replace(/ê/g, 'e').replace(/à/g, 'a').replace(/ù/g, 'u').replace(/î/g, 'i').replace(/ô/g, 'o').replace(/ç/g, 'c').replace(/É/g, 'E').replace(/È/g, 'E');
  return (
    `drawtext=fontfile='${FONT}':text='${safeText}':fontsize=28:fontcolor=white:` +
    `box=1:boxcolor=0x1e3a8a@0.91:boxborderw=14:` +
    `x='(W-tw)/2':y='${yPos}':` +
    `enable='between(t,${enableStart.toFixed(2)},${enableEnd.toFixed(2)})'`
  );
}

// Map marks to concatenated-video timestamps (same as trimmed, since segments aren't reordered)
const tKpiScore    = tm('kpi_score_focus');
const tKpiDone     = tm('kpi_score_done');
const tInsights    = tm('insights_done');
const tScrollTop   = tm('scroll_top');
const tAudits      = tm('audits_loaded');
const tAuditLinger = tm('audit_linger_done');
const tBack        = tm('back_overview');
const tFinal       = tm('final');

const callouts = [
  dt('Votre score SEO',
     tKpiScore + 0.3,
     tKpiDone + 0.4),

  dt('Priorites detectees automatiquement',
     tInsights - 3.5,
     tInsights + 1.2),

  dt('Audits SEO et actions correctives',
     tAudits + 1.8,
     tAuditLinger - 0.2),

  dt('FlowPoint centralise votre visibilite',
     tBack + 2.0,
     tFinal + 0.3),
];

const globalFades = [
  `fade=t=in:st=0:d=${globalFadeIn}:color=black`,
  `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${globalFadeOut}:color=black`,
].join(',');

const finalVf = [...callouts, globalFades].join(',');

const finalMp4 = join(OUT, 'v1-pilot-final.mp4');
ff([
  '-i', concatRaw,
  '-vf', finalVf,
  '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-an',
  finalMp4,
], 'final-callouts');

// ── QA + capture frames ───────────────────────────────────────────────────────
const finalDur  = probeDur(finalMp4);
const finalSize = parseInt(spawnSync('stat', ['-c', '%s', finalMp4], { stdio: 'pipe' }).stdout.toString().trim());
const probeOut  = spawnSync('ffprobe', [
  '-v', 'error', '-show_entries',
  'stream=codec_name,width,height,r_frame_rate,bit_rate:format=bit_rate',
  '-of', 'default=nw=1', finalMp4,
], { stdio: 'pipe' }).stdout.toString();

console.log('\nQA probe:\n' + probeOut);

// Capture representative frames
const frameTs = [
  { label: '0.5s-overview',       t: 0.5 },
  { label: 'kpi-hover',           t: tKpiScore - 0.5 },
  { label: 'kpi-zoom-callout',    t: tKpiScore + 0.8 },
  { label: 'insights-callout',    t: tInsights - 2.5 },
  { label: 'audits-overview',     t: tAudits + 0.5 },
  { label: 'audits-zoom-callout', t: tAudits + 2.5 },
  { label: 'back-overview-final', t: tBack + 2.5 },
];

console.log('\nCapturing frames:');
for (const { label, t } of frameTs) {
  const ts = Math.max(0, Math.min(t, finalDur - 0.5));
  const out = join(OUT, `frame_${label}.jpg`);
  const r = spawnSync('ffmpeg', [
    '-y', '-ss', ts.toFixed(2), '-i', finalMp4,
    '-vframes', '1', '-q:v', '2', '-vf', 'scale=960:540',
    out,
  ], { stdio: 'pipe' });
  if (r.status === 0) console.log(`  t=${ts.toFixed(1)}s → ${label}.jpg`);
  else console.log(`  FAILED frame at t=${ts.toFixed(1)}s`);
}

// ── Copy to destination ───────────────────────────────────────────────────────
spawnSync('cp', [finalMp4, join(DEST, 'step1-interface.mp4')]);

console.log('\n══════════════════════════════════════════════════════');
console.log('  V1 PILOT — RÉSULTATS FINAUX');
console.log('══════════════════════════════════════════════════════');
console.log(`  Ancien      : 1280×720, 48.5s, 1.72 MB`);
console.log(`  Nouveau     : ${W}×${H}, ${finalDur.toFixed(1)}s, ${(finalSize/1024/1024).toFixed(1)} MB`);
console.log(`  Codec       : H.264 CRF 18, ${FPS}fps, preset slow`);
console.log(`  Zooms       : t=${zA_start.toFixed(1)}–${zA_end.toFixed(1)}s (KPI ×1.28)  |  t=${zB_start.toFixed(1)}–${zB_end.toFixed(1)}s (Audits ×1.22)`);
console.log(`  Callouts    : 4 (score SEO, priorités, audits, centralise)`);
console.log(`  Fichier     : ${join(DEST, 'step1-interface.mp4')}`);
console.log(`  Frames      : ${join(OUT, 'frame_*.jpg')}`);
