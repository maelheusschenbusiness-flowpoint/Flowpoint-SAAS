---
name: FlowPoint QA harness
description: How to run the Playwright QA scans and interaction tests for the dashboard
---

# FlowPoint QA harness (Playwright)

Scripts in `.local/`: `qa_scan.mjs` (per-section scan: console errors, NaN/undefined text, toast-only buttons, failed API calls — sections as args), `qa_nan.mjs` (DOM NaN locator), `qa_interact.mjs` (real interactions: create/delete mission+monitor via UI, search, modal, SSE query-token), `qa_probe.mjs` (dump visible buttons + onclick per section).

**Dashboard Command Center alert rendering (B3 lesson):**
- `allAlerts` in the main Command Center list renders only `a.title` + `a.time` + severity badge — NOT `a.desc`.
- `a.desc` (e.g. "Latence observée : 149ms — seuil > 0ms") is only rendered in sub-views (performance, seo, etc.).
- DOM assert must target `a.title` (e.g. "Latence élevée") + `ev.siteUrl` (e.g. "httpbin.org") not the numeric value.
- `a.desc` field IS correctly computed in STATE; `innerText()` vs `innerHTML` distinction matters — use `innerText` for visible-text "no undefined/NaN" checks, `innerHTML` for structural presence checks.

**Rules learned:**
- Run from workspace root only — `node /tmp/x.mjs` cannot resolve `playwright`.
- Run section batches sequentially; parallel scans trigger 429 rate-limit artifacts.
- Auth: inject token via `addInitScript(t => localStorage.setItem('token', t))`; QA token in `/tmp/qa_session_token.txt`, account is plan Standard with 0 data (Pro locks and displayStat "—" are expected, not bugs).
- Key UI ids: `#mission-quick-add-btn`, `#monitor-new-btn`, mission panel `#nm2-*`, monitor panel `#nm-*`, float panel `#fp-float-panel` (close = `hidden` attribute, content stays in DOM).
- `closeFloatPanel` only sets `hidden` — test closure via attribute, not element removal.
- Google Maps in dev shows RefererNotAllowedMapError (key restriction, not a code bug); `window.gm_authFailure` handler + IntersectionObserver defensive shim added in dashboard.js near loadGoogleMaps.

## addInitScript masks logout assertions

`context.addInitScript` runs on **every** navigation, not just the first. Seeding
the auth token unconditionally re-injects it after a post-logout/post-deletion
redirect, so "did the app clear browser state?" always appears to fail.

Scope the seeding to the page under test:
`if (location.pathname.includes('dashboard')) { ...set token... }`

Also: a background server started with `cmd &` in one ShellExec call is reaped
before the next call. Start the server and run the suite in a single command.
And `cd X && node ... &` backgrounds the *whole* `cd &&` chain, so the shell
never changes directory — put `cd` on its own line.
