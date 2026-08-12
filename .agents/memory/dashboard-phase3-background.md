---
name: Phase 3 route-aware loading pattern
description: loadData() unlocks the UI only after the ACTIVE section's data is ready; other sections fill in background — no empty sections after the loader
---

# Phase 3 route-aware loading

**Rule:** `STATE.route` is set from localStorage (`fp:last-route`) + URL hash BEFORE `loadData()` runs (lines ~20780-20791). Phase 3 uses this to split fetches into:
- **3a (critical, blocking):** whichever of audits/monitors/reports/team the current route needs — awaited before `STATE.loading=false`
- **3b (background, non-blocking):** remaining sections — `Promise.allSettled(...).then(render)` after unlock

**Why:** Pure background loading (Phase 3 all background) made the loader disappear to reveal empty sections — worse than the original sequential await. Route-aware loading gives the best of both: fast unlock for overview (no critical fetch needed), populated active section for all other routes.

**Route → section mapping (in dashboard.js ~line 1525):**
- `_needsAudits`: audits, technical-audit, recommendations, croissance, growth, missions, competitor, performance, core-web-vitals, analytics, traffic, campaigns, audience, funnels, conversion, live, seo
- `_needsMonitors`: monitors, alerts-center
- `_needsReports`: reports
- `_needsTeam`: team, activity-feed
- `overview` (default): no critical fetch — unlocks immediately after Phase 2

**How to apply:**
- `_applySection(key, val)` is a `const` function expression (not declaration) defined just before 3a — closes over `audits/monitors/reports/team` let-vars from line ~1447
- Both 3a results AND 3b background results call `_applySection` — same logic, no duplication
- `classifySectionError` is defined inside `loadData()` at line ~1493, accessible in both 3a and 3b closures
- fp-backend.js watchdogs (3s/8s) check `!window.STATE.loading` before forcing re-render
