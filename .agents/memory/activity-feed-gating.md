---
name: ACTIVITY_FEED gating pattern
description: ACTIVITY_FEED (static fake entries with Sophie M./Lucas D.) is used as fallback in 5 places in dashboard.js — all must be PREVIEW_MODE gated
---

## Rule
Never render `ACTIVITY_FEED` directly for real (non-PREVIEW_MODE) users. Always gate:
```javascript
(PREVIEW_MODE ? ACTIVITY_FEED : []).slice(0,6).map(...)
```

## The 5 Locations (all fixed)
1. `exportActivityCsv()` — `STATE.activity || (PREVIEW_MODE ? ACTIVITY_FEED : [])`
2. Overview panel "Activité récente" widget (`id="activity-see-all"`)
3. Team panel "Activité récente de l'équipe" grid
4. `$('#activity-see-all')` click handler → `openFloatPanel`
5. `renderTeamActivity()` timeline sub-section

## Real users
- If `STATE.activityEvents` has entries → use them (map to display format with `_evtTypeMap`/`_evtIconMap`)
- If empty → show clean empty state div, never fake entries

**Why:** ACTIVITY_FEED contains hardcoded fake names (Sophie M., Lucas D., lucas@client.com) that violate the "Zéro faux visible" rule for logged-in non-preview users.

**How to apply:** Any time you add a new activity widget or modify the existing ones, check if ACTIVITY_FEED is used and ensure it's wrapped in `(PREVIEW_MODE ? ACTIVITY_FEED : [...real data...])`.
