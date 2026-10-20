/**
 * Focused regression test — AI floating-panel textarea scrollbar fix (P0).
 *
 * Static assertion over the SERVED artifacts (dashboard.css + dashboard.js).
 * The floating panel (#fp-ai-chat-input) must match the full-page (#ai-input) UX:
 *   1. Below max height (120px): NO scrollbar   → overflow-y default is `hidden`.
 *   2. scrollHeight > max: overflow-y toggled to `auto`   → discreet scrollbar shows.
 *   3. After send: content clears + returns to min height + overflow-y `hidden`.
 *   4. Both send paths (click + Enter) route through sendMessage()/reset — shared reset.
 *   5. Discreet ~5px webkit scrollbar with track spacing + dark/light support,
 *      scoped to #fp-ai-chat-input (no global CSS changed).
 *
 * No browser/server required: this parses the shipped source so it stays green
 * in CI and pinpoints exactly which invariant regressed.
 *
 * Run: node scripts/verify-ai-textarea-scrollbar.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts', 'flowpoint-export');
const css = readFileSync(join(ROOT, 'dashboard.css'), 'utf8');
const js = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
}

// Isolate the .fp-ai-chat-input base rule block (not the :focus / ::-webkit variants).
const baseRuleMatch = css.match(/\.fp-ai-chat-input\s*\{([^}]*)\}/);
const baseRule = baseRuleMatch ? baseRuleMatch[1] : '';

// 1. Base overflow-y must default to hidden (JS toggles to auto only past max).
check(
  'CSS .fp-ai-chat-input defaults overflow-y:hidden',
  /overflow-y:\s*hidden/.test(baseRule),
  baseRule.match(/overflow-y:\s*[a-z]+/)?.[0] || 'overflow-y not found in base rule'
);
check(
  'CSS .fp-ai-chat-input NOT overflow-y:auto in base rule',
  !/overflow-y:\s*auto/.test(baseRule),
  'base rule must not force auto'
);

// 2. Right-padding so text does not slide under the scrollbar (matches #ai-input padding-right:18px).
check(
  'CSS .fp-ai-chat-input has right padding for scrollbar clearance',
  /padding:\s*10px\s+18px/.test(baseRule) || /padding-right/.test(baseRule),
  baseRule.match(/padding:\s*[^;]+/)?.[0] || 'no padding'
);

// 3. Scoped, discreet webkit scrollbar (~5px) with track spacing + hover.
check('CSS scoped scrollbar width ~5px',
  /#fp-ai-chat-input::-webkit-scrollbar\s*\{[^}]*width:\s*5px/.test(css));
check('CSS scoped scrollbar-track transparent with margin (right/vertical spacing)',
  /#fp-ai-chat-input::-webkit-scrollbar-track\s*\{[^}]*(background:\s*transparent)[^}]*margin/.test(css));
check('CSS scoped scrollbar-thumb styled + hover',
  /#fp-ai-chat-input::-webkit-scrollbar-thumb\s*\{/.test(css) &&
  /#fp-ai-chat-input::-webkit-scrollbar-thumb:hover\s*\{/.test(css));

// 4. Dark AND light theme support for the scoped thumb.
check('CSS dark-theme scoped thumb override',
  /html\[data-theme="dark"\]\s*#fp-ai-chat-input::-webkit-scrollbar-thumb/.test(css));
// Light theme is the default (base) thumb rule; explicitly ensure base is not dark-only.
check('CSS base (light/default) scoped thumb present',
  /#fp-ai-chat-input::-webkit-scrollbar-thumb\s*\{[^}]*background/.test(css));

// 5. No GLOBAL scrollbar rule was altered — the fix must be scoped.
//    Guard: our new webkit rules must all be prefixed with the #fp-ai-chat-input id.
const strayGlobal = /(^|\})\s*::-webkit-scrollbar\s*\{[^}]*width:\s*5px/.test(css);
check('No unscoped global ::-webkit-scrollbar width:5px added', !strayGlobal);

// 6. JS resize helper toggles overflow based on scrollHeight vs max (120px).
check('JS _fpChatResize toggles overflow-y auto/hidden by scrollHeight',
  /_fpChatResize\s*\([^)]*\)\s*\{[\s\S]*?overflowY\s*=\s*sh\s*>\s*_FP_CHAT_MAX_H\s*\?\s*'auto'\s*:\s*'hidden'/.test(js));

// 7. JS reset helper clears value + min height + overflow hidden.
check('JS _fpChatReset clears value, sets min height + overflow-y hidden',
  /_fpChatReset\s*\([^)]*\)\s*\{[\s\S]*?\.value\s*=\s*''[\s\S]*?height\s*=\s*_FP_CHAT_MIN_H[\s\S]*?overflowY\s*=\s*'hidden'/.test(js));

// 8. Min/Max constants match the panel CSS (42px min per .fp-ai-chat-input, 120px max).
check('JS min height constant = 42px', /_FP_CHAT_MIN_H\s*=\s*42/.test(js));
check('JS max height constant = 120px', /_FP_CHAT_MAX_H\s*=\s*120/.test(js));

// 9. input + paste handlers call the shared resize helper.
check('JS input handler calls _fpChatResize',
  /input\.addEventListener\('input',[\s\S]*?_fpChatResize\(input\)/.test(js));
check('JS paste handler calls _fpChatResize',
  /input\.addEventListener\('paste',[\s\S]*?_fpChatResize\(input\)/.test(js));

// 10. Send path resets via shared helper — used by BOTH click + Enter (they both call sendMessage).
check('JS sendMessage uses _fpChatReset (shared by click + Enter paths)',
  /_fpChatReset\(inp\)/.test(js));
check('JS Enter (keydown) send path routes through sendMessage',
  /key\s*===\s*'Enter'\s*&&\s*!e\.shiftKey[\s\S]*?sendMessage\(input\.value\.trim\(\)\)/.test(js));
check('JS click send path routes through sendMessage',
  /sendBtn\.addEventListener\('click',[\s\S]*?sendMessage\(input\.value\.trim\(\)\)/.test(js));

// 11. Old incomplete reset (height='auto' with no overflow reset) must be gone from sendMessage.
check('JS old incomplete reset removed (no bare height=auto on inp in sendMessage)',
  !/inp\.value\s*=\s*'';\s*inp\.style\.height\s*=\s*'auto';/.test(js));

// ── Report ──
console.log('\n' + '═'.repeat(66));
console.log('  AI FLOATING-PANEL TEXTAREA SCROLLBAR — REGRESSION CHECK');
console.log('═'.repeat(66));
let pass = 0, fail = 0;
for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  if (r.ok) pass++; else fail++;
  console.log(`  ${icon}  ${r.name}`);
  if (!r.ok && r.detail) console.log(`        → ${r.detail}`);
}
console.log(`\n  ${pass}/${pass + fail} assertions passed  |  ${fail} failure(s)`);
console.log('═'.repeat(66) + '\n');
process.exit(fail === 0 ? 0 : 1);
