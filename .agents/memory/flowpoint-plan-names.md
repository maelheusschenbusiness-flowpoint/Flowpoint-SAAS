---
name: FlowPoint plan names — Pro+ elimination
description: Plan hierarchy is Standard < Pro < Ultra; Pro+ must never appear anywhere in the UI.
---

## Rule
Only three plan names are valid in FlowPoint: **Standard**, **Pro**, **Ultra**.
The label "Pro+" must never appear in button text, badges, select options, or plan tags.

**Why:** Product decision — "Pro+" is confusing and not a real plan. The upgrade path is Standard → Pro → Ultra.

## How to apply
When adding plan-gated UI (badges, disabled states, upgrade CTAs):
- Use `Pro` for mid-tier features
- Use `Ultra` for top-tier features (advanced storage, AI Strategist, market intel)
- Never write `Pro+`, `Agency+`, or any variant

## Fixes applied (2026-07-01)
Six occurrences of "Pro+" were found and corrected:
1. Monitors interval select: `Toutes les 1 min (Pro+)` → `Pro`
2. Local SEO "Intelligence des avis" badge → `Pro`
3. Growth "Performance Géographique" badge → `Pro`
4. Storage addon `tag:'Pro+'` → `tag:'Ultra'` (365-day retention is Ultra-level)
5. AI credits +500k pack `tag:'Pro+'` → `tag:'Pro'`
6. Audit detail "Fix IA — plan Pro+" → `plan Pro`

## Grep command to detect regressions
```bash
grep -n "Pro+" dashboard.js | grep -v "Standard+"
```
(Standard+ is a valid addon tag, not a plan name)
