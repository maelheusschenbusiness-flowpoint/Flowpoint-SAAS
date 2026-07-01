---
name: innerHTML script extraction pattern
description: <script> tags injected via innerHTML are NOT executed by browsers — all modal/action window functions must live in the JS setup block, not in render string templates
---

## Rule
Any `window._functionName = function() {}` defined inside a render function's return string (injected via innerHTML) will NEVER execute in the browser.

**Why:** The HTML spec prohibits executing scripts inserted via innerHTML for security reasons. Only scripts in the original document parse (or added via `document.createElement('script')`) execute.

## How to apply
When adding interactive modal functions or action handlers in dashboard.js render functions:

1. **Never** put `window._fn = function() {}` inside a template literal returned by a render function
2. **Always** put them in the global setup block (around line ~13930 in dashboard.js) alongside existing patterns like `_showCreateHeatmapModal`, `_showAddKeyword`, etc.
3. The setup block comment pattern is: `// FunctionName — extracted from innerHTML <script> (scripts in innerHTML do NOT execute)`

## Known extractions already done
- `window._showCreateHeatmapModal` — heatmap modal show
- `window._submitCreateHeatmap` — heatmap POST to /api/local-maps/heatmaps
- `window._showAnalyzeReviewModal` — review analyze modal show
- `window._submitAnalyzeReview` — review POST to /api/review-intelligence/analyze
- `window._showLoadRankingsModal` — rankings keyword/city modal
- `window._submitLoadRankings` — rankings POST to /api/local-seo/rankings
- `window._generateLocalMissions` — create 5 standard local SEO missions via _fpMQ
- `window._toggleSatelliteMode` — visual satellite/map toggle on #fp-gmap SVG
- `window._reloadIntgData`, `_showConnectModal`, `_showNewWebhookModal`, `_submitConnect`, `_testWebhook`, `_toggleWebhook`, `_deleteWebhook`, `_retryRun`, `_useTemplate`, `_createIncomingWebhook` — integrations section (deleted 115-line innerHTML block)

## Remaining innerHTML script block (known)
Line ~28769: GitHub repos section IIFE — runs `FP_GITHUB_API.getRepos()` and populates `gh-repos-container`. Not one of the 6 core sections. Extract if GitHub is prioritized.

## Detection
```bash
grep -n "^      <script>" dashboard.js
```
