---
name: FlowPoint SPA route and sub-route map
description: Correct navigate()/navigateSub() routes for modal/section testing
---

## Top-level routes (navigate())
`overview`, `audits`, `monitors`, `missions`, `reports`, `billing`, `settings`, `alerts-center`, `local-seo`, `competitor`, `keywords`, `growth`, `conversion`, `forecast`, `calendar`, `ai`, `crm`, `market-intelligence`, `team`

Note: `gbp-posts` and `local-maps` are **NOT** valid top-level routes — they silently fail.

## Local SEO sub-routes (navigateSub())
| sub | renders |
|-----|---------|
| `map` | `renderLocalDominationMaps()` — heatmaps, `#fp-heatmap-modal` here |
| `zones` | `renderLocalSEOZones()` — geographic zones (no heatmap modal) |
| `competitors` | `renderLocalSEOCompetitors()` |
| `opportunities` | `renderLocalSEOOpportunities()` |
| `reviews` | `renderLocalSEOReviews()` |
| `gbp` | `renderLocalSEOGBP()` — GBP posts, reviews |
| `competitors-map` | `renderLocalCompetitorMap()` |

## Calendar / Missions calendar
- The `calendar` SPA route shows a scheduling/activity calendar (date-range: 3j/7j/30j)
- The **monthly missions calendar** (with `.fp-cal-add-btn` day-cell buttons) is accessed by navigating to `missions` and setting `STATE.missionView = 'calendar'` then calling `render()`
- `.fp-cal-add-btn` buttons are `opacity:0` by CSS (hover-only) → use `click({ force: true })` in Playwright

## Modal system
- Float panel: `openFloatPanel(title, html)` → `#fp-float-panel` (removes `hidden` attr)
- Keyword modal: `window._showAddKeyword()` → `#fp-kw-modal` (display:flex)
- Heatmap modal: `window._showCreateHeatmapModal()` → `#fp-heatmap-modal` (display:flex)
- All three are accessible after IIFE init without navigating to the section first
