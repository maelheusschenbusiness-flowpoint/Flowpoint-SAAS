---
name: dashboard.js init() delegation pattern
description: Why event handlers for critical UI elements must live at IIFE global scope, not inside init()
---

## Rule
Any event handler that must work reliably (nav buttons, activity panel button, filter buttons) must be registered via `document.addEventListener` at the IIFE **global scope**, not inside `init()` or functions called by `init()`.

## Why
`init()` is an `async function` that `await`s `loadData()` and then runs many setup calls. If any async operation rejects without being caught (unhandledRejection), the async error propagates through `init()` and prevents all subsequent lines from executing — including `bindActivityPanel()`, `bindGlobalEvents()`, and the `window.XYZ = fn` assignments.

Evidence: `window.navigate` was confirmed present (set at both global scope line ~28625 AND inside init()), while `window.openActivityPanel` (set only inside init()) was `undefined`. The activity button had no click listener despite `bindActivityPanel()` appearing correct, because init() never reached that call.

## How to apply
- When adding a new persistent event handler in dashboard.js, register it via document delegation at the IIFE global scope (near line 29711 where the activity delegation was added), not inside `init()`.
- Pattern: `document.addEventListener('click', function(e) { if (e.target.closest('#my-btn')) { ... } });`
- The existing nav-button binding in `bindGlobalEvents()` (called from init()) is therefore also unreliable in headless Playwright — use hash navigation (`page.goto(DASH + '#route')`) to navigate in tests instead of clicking nav buttons.
- Playwright certification: always use CJS (`.cjs`) not ESM (`.mjs`) — ESM causes `require is not defined` in the sandbox. Use `page.waitForRequest()` to intercept API calls, `page.locator().click()` for interactions, and URL hash for SPA navigation.

**2026-08-04 :** le bloc i18n complet (catalogues FP_I18N_*, `window._fpTFn`, `fpApplyTranslations`, `applyLanguagePref`) était défini *à l'intérieur* de `init()` — si init() sortait tôt, aucune traduction ne s'appliquait (de/it/pl restaient en français). Déplacé au scope global de l'IIFE (juste avant `async function init()`). Toute définition `window.*` critique doit vivre au scope global, jamais dans init().
