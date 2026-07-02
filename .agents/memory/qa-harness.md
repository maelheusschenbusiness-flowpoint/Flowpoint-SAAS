---
name: FlowPoint QA harness
description: How to run the Playwright QA scans and interaction tests for the dashboard
---

# FlowPoint QA harness (Playwright)

Scripts in `.local/`: `qa_scan.mjs` (per-section scan: console errors, NaN/undefined text, toast-only buttons, failed API calls — sections as args), `qa_nan.mjs` (DOM NaN locator), `qa_interact.mjs` (real interactions: create/delete mission+monitor via UI, search, modal, SSE query-token), `qa_probe.mjs` (dump visible buttons + onclick per section).

**Rules learned:**
- Run from workspace root only — `node /tmp/x.mjs` cannot resolve `playwright`.
- Run section batches sequentially; parallel scans trigger 429 rate-limit artifacts.
- Auth: inject token via `addInitScript(t => localStorage.setItem('token', t))`; QA token in `/tmp/qa_session_token.txt`, account is plan Standard with 0 data (Pro locks and displayStat "—" are expected, not bugs).
- Key UI ids: `#mission-quick-add-btn`, `#monitor-new-btn`, mission panel `#nm2-*`, monitor panel `#nm-*`, float panel `#fp-float-panel` (close = `hidden` attribute, content stays in DOM).
- `closeFloatPanel` only sets `hidden` — test closure via attribute, not element removal.
- Google Maps in dev shows RefererNotAllowedMapError (key restriction, not a code bug); `window.gm_authFailure` handler + IntersectionObserver defensive shim added in dashboard.js near loadGoogleMaps.
