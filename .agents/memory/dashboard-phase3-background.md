---
name: Phase 3 background loading pattern
description: loadData() Phase 3 (audits/monitors/reports/team) now runs in background after first render so dashboard is interactive after /api/me + overview only
---

# Phase 3 background loading

**Rule:** `STATE.loading=false` and `_doRender()` now fire right after Phase 2 (overview + plan + catalog). Phase 3 section data (audits, monitors, reports, team) runs via `Promise.allSettled(...).then(...)` without blocking interactivity.

**Why:** Mobile first-render was blocked 15-20s because Phases 2+3 were sequential `await`. Moving Phase 3 to background reduces TTI to time(me) + max(Phase2) only (~3-5s instead of 15-20s). Section pages show empty states while data loads, then re-render via `render()` in the `.then()` callback.

**How to apply:**
- Lines around 1446-1500 in dashboard.js hold the bootstrap split
- The `classifySectionError` function is still defined inside `loadData()` — accessible in the `.then()` closure
- Variables `audits/monitors/reports/team` are still declared with `let` at line ~1401 (outer scope) so the `.then()` closure can set them

**fp-backend.js watchdogs also fixed:** `verifyContentRenders` (3s/8s) and `startRenderPoller` (300ms) now check `!window.STATE.loading` before forcing render to avoid firing while dashboard is still loading.
