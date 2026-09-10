/**
 * V1 pilot — continuous final pass.
 * Uses the existing raw 1920x1080 WebM recording and marks.json.
 * No segment cuts or interstitial fades: zooms are continuous scale/crop
 * animations, with only the global intro/outro fades retained.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/fp-v1pilot";
const DEST = "/home/runner/workspace/artifacts/flowpoint-export/onboarding/step1-interface.mp4";
const WEBM = join(OUT, "raw", "page@0ee5d0397cf5f3797a442ae7c8241594.webm");
const FONT = "/home/runner/workspace/tools/InterVariable.ttf";
const W = 1920;
const H = 1080;

const { skipMs, marks } = JSON.parse(readFileSync(join(OUT, "marks.json"), "utf8"));
const trimStart = Math.max(0, (skipMs - 600) / 1000);
const mark = (name) => (marks[name] ?? 0) + 0.6;
const duration = parseFloat(spawnSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", WEBM,
], { stdio: "pipe" }).stdout.toString().trim()) - trimStart;

const kpiStart = Math.max(0.5, mark("kpi_score_focus") - 0.5);
const kpiEnd = Math.min(duration, mark("kpi_score_done") + 0.8);
const auditStart = Math.max(0, mark("audits_loaded") - 0.3);
const auditEnd = Math.min(duration, mark("audit_linger_done") + 0.8);

// A triangle ramp: 0 → 1 → 0, with a smooth continuous zoom.
const ramp = (t, start, end, rise = 1.0) =>
  `(min(1,max(0,(t-${start.toFixed(3)})/${rise.toFixed(3)}))-min(1,max(0,(t-${(end-rise).toFixed(3)})/${rise.toFixed(3)})))`;

const zoomExpr = `1+0.28*${ramp("t", kpiStart, kpiEnd)}+0.22*${ramp("t", auditStart, auditEnd)}`;
const fadeOutAt = Math.max(0, duration - 0.8);

function drawtext(text, start, end) {
  const safe = text
    .replace(/\\/g, "")
    .replace(/'/g, "")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,");
  return [
    `drawtext=fontfile='${FONT}'`,
    `text='${safe}'`,
    "fontsize=28",
    "fontcolor=white",
    "box=1",
    "boxcolor=0x1e3a8a@0.91",
    "boxborderw=14",
    "x='(W-tw)/2'",
    "y='H-118'",
    `enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`,
  ].join(":");
}

const callouts = [
  drawtext("Votre score SEO", mark("kpi_score_focus") + 0.3, mark("kpi_score_done") + 0.4),
  drawtext("Priorites detectees automatiquement", mark("insights_done") - 3.5, mark("insights_done") + 1.2),
  drawtext("Audits SEO et actions correctives", auditStart + 1.8, mark("audit_linger_done") + 0.4),
  drawtext("FlowPoint centralise votre visibilite", mark("back_overview") + 2.0, mark("final") + 0.3),
];

const vf = [
  `scale=w='1920*${zoomExpr}':h='1080*${zoomExpr}':eval=frame`,
  "crop=1920:1080:(iw-1920)/2:(ih-1080)/2",
  "fps=30",
  ...callouts,
  "fade=t=in:st=0:d=0.8:color=black",
  `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=0.8:color=black`,
].join(",");

console.log(`Input duration: ${duration.toFixed(2)}s`);
console.log(`Continuous KPI zoom: ${kpiStart.toFixed(2)}–${kpiEnd.toFixed(2)}s ×1.28`);
console.log(`Continuous audit zoom: ${auditStart.toFixed(2)}–${auditEnd.toFixed(2)}s ×1.22`);
console.log("Font:", FONT);

const result = spawnSync("ffmpeg", [
  "-y",
  "-ss", trimStart.toFixed(3),
  "-i", WEBM,
  "-vf", vf,
  "-c:v", "libx264",
  "-crf", "18",
  "-preset", "slow",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-an",
  DEST,
], { stdio: "pipe", maxBuffer: 32 * 1024 * 1024 });

if (result.status !== 0) {
  console.error(result.stderr?.toString().slice(-4000));
  process.exit(result.status || 1);
}

const probe = spawnSync("ffprobe", [
  "-v", "error",
  "-show_entries", "stream=codec_name,width,height,r_frame_rate,bit_rate:format=duration,size,bit_rate",
  "-of", "default=nw=1",
  DEST,
], { stdio: "pipe" }).stdout.toString();
console.log(probe);