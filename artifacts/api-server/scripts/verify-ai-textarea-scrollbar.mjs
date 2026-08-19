#!/usr/bin/env node
/**
 * verify-ai-textarea-scrollbar.mjs — Task #614
 *
 * Static verification that every AI input surface in dashboard.js implements
 * the unified textarea contract:
 *   1. Auto-grows on input up to a max height (120px).
 *   2. Vertical scrollbar ONLY when content exceeds the max (overflow-y:auto),
 *      hidden otherwise — so the field stays scrollable for long messages.
 *   3. Resizes after paste (async, so the DOM has the pasted content).
 *   4. Resets to its min height with no scrollbar after send — on BOTH send
 *      paths (button click and Enter key).
 *
 * Surfaces:
 *   A. #ai-input          — full-page AI assistant  (min 38px)
 *   B. #fp-ai-chat-input  — floating AI chat panel  (min 42px, _FP_CHAT_*)
 *   C. #ai-panel-input    — topbar quick AI panel   (min 34px)
 *
 * Exit code 0 = all checks pass; 1 = at least one failure (CI-friendly).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = resolve(__dirname, "../../flowpoint-export/dashboard.js");
const DASHBOARD_HTML = resolve(__dirname, "../../flowpoint-export/dashboard.html");

const src = readFileSync(DASHBOARD, "utf8");
// The floating panel's markup is static HTML (dashboard.html); its behavior
// (_fpChatResize/_fpChatReset) lives in dashboard.js.
const html = readFileSync(DASHBOARD_HTML, "utf8");

let failures = 0;
let passes = 0;

function check(label, ok, hint) {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${hint ? ` — ${hint}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ── Surface A: full-page #ai-input ───────────────────────────────────────────
section("Surface A — #ai-input (full-page AI assistant)");
check(
  "#ai-input is a textarea",
  /<textarea[^>]*id="ai-input"/.test(src),
  "expected <textarea id=\"ai-input\">"
);
check(
  "auto-grow capped at 120px (_resizeAiInput)",
  /function _resizeAiInput\(\)[\s\S]{0,400}?Math\.min\(sh,\s*120\)/.test(src)
);
check(
  "scrollbar only when content exceeds max (overflowY toggle)",
  /function _resizeAiInput\(\)[\s\S]{0,400}?overflowY\s*=\s*sh\s*>\s*120\s*\?\s*'auto'\s*:\s*'hidden'/.test(src)
);
check(
  "reset to min height 38px after send (_resetAiInput)",
  /function _resetAiInput\(\)[\s\S]{0,400}?height\s*=\s*'38px'[\s\S]{0,200}?overflowY\s*=\s*'hidden'/.test(src)
);
check(
  "input listener resizes",
  /aiInput\?\.addEventListener\('input',\s*\(\)\s*=>\s*\{\s*\n?\s*_resizeAiInput\(\)/.test(src)
);
check(
  "paste listener resizes asynchronously",
  /aiInput\?\.addEventListener\('paste',\s*\(\)\s*=>\s*setTimeout\(_resizeAiInput,\s*0\)\)/.test(src)
);
check(
  "click send path resets",
  /aiSend\?\.addEventListener\('click',[^\n]*_resetAiInput\(\)/.test(src)
);
check(
  "Enter send path resets (Shift+Enter excluded)",
  /aiInput\?\.addEventListener\('keydown',[^\n]*e\.key==='Enter'\s*&&\s*!e\.shiftKey[^\n]*_resetAiInput\(\)/.test(src)
);

// ── Surface B: floating panel #fp-ai-chat-input ──────────────────────────────
section("Surface B — #fp-ai-chat-input (floating AI chat panel)");
check(
  "#fp-ai-chat-input is a textarea (dashboard.html)",
  /<textarea[\s\S]{0,200}?id="fp-ai-chat-input"/.test(html),
  "expected <textarea id=\"fp-ai-chat-input\"> in dashboard.html"
);
check(
  "auto-grow capped at max (_fpChatResize with _FP_CHAT_MAX_H)",
  /function _fpChatResize\(el\)[\s\S]{0,400}?Math\.min\(sh,\s*_FP_CHAT_MAX_H\)/.test(src)
);
check(
  "scrollbar only when content exceeds max",
  /function _fpChatResize\(el\)[\s\S]{0,400}?overflowY\s*=\s*sh\s*>\s*_FP_CHAT_MAX_H\s*\?\s*'auto'\s*:\s*'hidden'/.test(src)
);
check(
  "reset to min height after send (_fpChatReset)",
  /function _fpChatReset\(el\)[\s\S]{0,400}?height\s*=\s*_FP_CHAT_MIN_H\s*\+\s*'px'[\s\S]{0,200}?overflowY\s*=\s*'hidden'/.test(src)
);
check(
  "sendMessage() resets the input (shared by click + Enter paths)",
  /async function sendMessage\(message\)[\s\S]{0,500}?_fpChatReset\(inp\)/.test(src)
);
check(
  "input listener resizes",
  /input\.addEventListener\('input',[\s\S]{0,200}?_fpChatResize\(input\)/.test(src)
);
check(
  "paste listener resizes asynchronously",
  /input\.addEventListener\('paste',\s*\(\)\s*=>\s*setTimeout\(\(\)\s*=>\s*_fpChatResize\(input\),\s*0\)\)/.test(src)
);

// ── Surface C: topbar quick panel #ai-panel-input ────────────────────────────
section("Surface C — #ai-panel-input (topbar quick AI panel)");
check(
  "#ai-panel-input is a textarea (was a plain <input>)",
  /<textarea[^>]*id="ai-panel-input"/.test(src) && !/<input[^>]*id="ai-panel-input"/.test(src),
  "expected <textarea id=\"ai-panel-input\"> and no <input> variant left"
);
check(
  "declared min/max heights (34px / 120px)",
  /id="ai-panel-input"[^>]*min-height:34px[^>]*max-height:120px/.test(src)
);
check(
  "auto-grow capped at 120px (_panelResize)",
  /function _panelResize\(\)[\s\S]{0,400}?Math\.min\(sh,\s*120\)/.test(src)
);
check(
  "scrollbar only when content exceeds max",
  /function _panelResize\(\)[\s\S]{0,400}?overflowY\s*=\s*sh\s*>\s*120\s*\?\s*'auto'\s*:\s*'hidden'/.test(src)
);
check(
  "reset to min height after send (_panelReset)",
  /function _panelReset\(\)[\s\S]{0,400}?height\s*=\s*'34px'[\s\S]{0,200}?overflowY\s*=\s*'hidden'/.test(src)
);
check(
  "input listener resizes",
  /panelInput\?\.addEventListener\('input',\s*_panelResize\)/.test(src)
);
check(
  "paste listener resizes asynchronously",
  /panelInput\?\.addEventListener\('paste',\s*\(\)\s*=>\s*setTimeout\(_panelResize,\s*0\)\)/.test(src)
);
check(
  "click send path resets before sending",
  /panelSend\?\.addEventListener\('click',[\s\S]{0,300}?_panelReset\(\)/.test(src)
);
check(
  "Enter sends (Shift+Enter = newline) via the click path",
  /panelInput\?\.addEventListener\('keydown',[^\n]*e\.key==='Enter'\s*&&\s*!e\.shiftKey[^\n]*panelSend\?\.click\(\)/.test(src)
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.error("\nFAIL — AI textarea contract violated in dashboard.js");
  process.exit(1);
}
console.log("\nOK — all AI input surfaces implement the unified textarea contract");
