/**
 * Validates the 6 corrections directly against the served dashboard.js file
 * by grepping the exact HTML patterns — no auth required.
 */
import { readFile } from 'fs/promises';

const src = await readFile('/home/runner/workspace/artifacts/flowpoint-export/dashboard.js', 'utf8');

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, pass: condition, detail });
}

// ── C1 : Map legend theme-aware ──
const legendTheme = (src.match(/background:var\(--fp-surface\);border:1px solid var\(--fp-border\);border-radius:10px;padding:10px 14px;z-index:5/g) || []).length;
const legendOldDark = (src.match(/bottom:50px.*background:rgba\(10,14,27,0\.88\)/g) || []).length;
check('C1 – Legend uses var(--fp-surface) [2 occurrences]', legendTheme >= 2, `found: ${legendTheme}`);
check('C1 – No old rgba(10,14,27,0.88) in legend overlay', legendOldDark === 0, `found: ${legendOldDark}`);

// ── C2 : Header flex-column ──
const headerFlexCol = (src.match(/display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-bottom:1px solid var\(--fp-border\)/g) || []).length;
const titleNoOverflow = src.includes("🏴 Carte des concurrents</div>") &&
  !src.includes("overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0\">🏴 Carte des concurrents");
check('C2 – Header is flex-column', headerFlexCol >= 1, `found: ${headerFlexCol}`);
check('C2 – Title no longer has overflow:hidden/nowrap', titleNoOverflow);

// ── C3 : 50km / 100km options ──
const opt50a = (src.match(/value="50000">50 km/g) || []).length;
const opt100a = (src.match(/value="100000">100 km/g) || []).length;
check('C3 – 50km option in select (≥2 occurrences)', opt50a >= 2, `found: ${opt50a}`);
check('C3 – 100km option in select (≥2 occurrences)', opt100a >= 2, `found: ${opt100a}`);

// ── C4 : Stop button ──
const stopWithSpan = (src.match(/id="ai-stop"[^>]*><span style="display:block;width:13px;height:13px;background:#fff;border-radius:2px;flex-shrink:0"><\/span><\/button>/g) || []).length;
const panelStopWithSpan = (src.match(/id="ai-panel-stop"[^>]*><span style="display:block;width:13px;height:13px;background:#fff;border-radius:2px;flex-shrink:0"><\/span><\/button>/g) || []).length;
const stopOldChar = (src.match(/id="ai-stop"[^>]*>⏹<\/button>/g) || []).length;
const panelStopOldChar = (src.match(/id="ai-panel-stop"[^>]*>⏹<\/button>/g) || []).length;
check('C4 – #ai-stop uses white square span', stopWithSpan >= 1, `found: ${stopWithSpan}`);
check('C4 – #ai-panel-stop uses white square span', panelStopWithSpan >= 1, `found: ${panelStopWithSpan}`);
check('C4 – No old ⏹ in #ai-stop', stopOldChar === 0, `found: ${stopOldChar}`);
check('C4 – No old ⏹ in #ai-panel-stop', panelStopOldChar === 0, `found: ${panelStopOldChar}`);

// ── C5 : Team activity single column ──
const activityFlex = src.includes('"fp-team-activity-grid" style="display:flex;flex-direction:column;gap:8px"');
const activityOld2Col = src.includes('"fp-team-activity-grid" style="display:grid;grid-template-columns:repeat(2,1fr)');
check('C5 – Team activity is flex-column', activityFlex);
check('C5 – No old 2-column grid on team activity', !activityOld2Col);

// ── C6 : Add-on cards flex-column + margin-top:auto ──
const addonFlexCol = (src.match(/display:flex;flex-direction:column" onmouseenter/g) || []).length;
const addonMarginAuto = (src.match(/margin-top:auto;padding-top:6px/g) || []).length;
check('C6 – Addon card has flex-direction:column', addonFlexCol >= 1, `found: ${addonFlexCol}`);
check('C6 – Addon bottom row has margin-top:auto', addonMarginAuto >= 1, `found: ${addonMarginAuto}`);

// ── SOURCE == EXPORT sync ──
import { readFile as rf } from 'fs/promises';
const src2 = await rf('/home/runner/workspace/src/frontend/dashboard.js', 'utf8');
check('SOURCE ↔ EXPORT identical', src === src2);

// ── Print results ──
let passed = 0, failed = 0;
for (const c of checks) {
  const icon = c.pass ? '✅' : '❌';
  console.log(`${icon} ${c.name}${c.detail ? ' [' + c.detail + ']' : ''}`);
  if (c.pass) passed++; else failed++;
}
console.log(`\nTotal: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
