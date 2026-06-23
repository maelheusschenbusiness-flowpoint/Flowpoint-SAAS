---
name: renderGrowthCommandCenter demock
description: 19 chirurgical edits to remove all hardcoded/fake data from the Growth page and make buttons functional
---

## Rule
Every data point in renderGrowthCommandCenter must come from STATE or show a clean empty state.
Never show hardcoded numbers (traffic, leads, revenue, competitor scores, GBP issue counts, streak days) outside PREVIEW_MODE.

## Key STATE mappings
- Sparklines: `STATE.overview.auditHistory` (7pts) → flat line from avgSc if empty
- Forecast step: `_projStep = avg slope of sparkS` (max 4, min 0.5)
- Revenue cards: `_kwStats.totalVolume×0.06` (traffic), `overview.conversionRate` (leads), `overview.revenue` (revenue) → show "—" (na:true) if null
- Radar: `_comp1 = STATE.competitors[0]`, competitor dims derived from `_c1Score`
- Roadmap status: avgSc≥65+audits→Phase01 done; kwData→Phase02 active; competitors→Phase03 active; convRate→Phase04 active
- Badges: audits.length>0, me.streakDays≥7, completedMissions≥5, avgSc≥70, lseo.domScore≥80, level≥5
- GBP items: lseo.unrepliedReviews, lseo.photoCount<10, lseo.lastGbpPostDaysAgo>14
- Streaks: me.streakDays, completedMissions+audits.length+monitors.length, completedMissions
- "Vous" row: `_mySpeed` (avg audit speed), `_lseo.avgRating`, `overview.marketShare`

## window._launchQuickWin pattern
Defined at top of renderGrowthCommandCenter body (before `return \`...\``):
```js
window._launchQuickWin = async function(title, diffN, time, roi) {
  var ms = { id:'qw_'+Date.now(), title, priority: diffN===1?'high':diffN===2?'medium':'low', ... };
  STATE.missions = (STATE.missions||[]).concat([ms]);
  saveMissions();
  await window.FP_MISSIONS_API.create(ms);
  navigate('missions');
};
```
Button calls: `onclick="window._launchQuickWin(${JSON.stringify(w.title)},${w.diff},${JSON.stringify(w.time)},${JSON.stringify(w.roi||'')})"` 

## Why
User reported entire Growth page (chips, rings, revenue, AI insights, Quick Wins, roadmap, competitors, GBP, achievements, stratège) was showing fake Paris-specific content and non-functional buttons.

## How to apply
When adding new sections: always check if value comes from STATE or real computation. If null→show "—" or empty state with "connect your data" CTA. Never hardcode named cities, traffic numbers, revenue figures, or percentage improvements outside PREVIEW_MODE.
