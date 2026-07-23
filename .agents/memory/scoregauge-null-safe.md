---
name: scoreGauge null-safe pattern
description: How to handle null/absent values in the scoreGauge SVG widget and healthMetrics cards
---

## Rule
`scoreGauge(val, max, color)` must never interpolate `val` directly when val can be null.
Guard with `hasVal = val != null && Number.isFinite(val)`.
- null → label "—" in grey, arc circle hidden
- real score → label = String(val), colored arc

## healthMetrics source values
Never use `?? 0` or `: 0` as a fallback for absent metric data.
Use `null` so the null-safe rendering path activates:
- SEO Health: `STATE.audits.length > 0 ? avg : null`
- Conversion GA4: `conversionRate` (already null when no GA4)
- Local Visibility: `null` when no overview.localScore or seoScore > 0
- Competitor Pressure: `null` when no competitors
- Revenue Opportunity: `null` when revenueOpp is null

## Badge rendering
When `_hv = val != null && Number.isFinite(val)` is false:
- Show `<div class="..." style="color:var(--fp-text-faint);font-style:italic">Pas de données</div>` instead of "Bon/Attention/Faible"
- Progress bar width = 0%, background = transparent

**Why:** On empty accounts, val=0 was treated as a valid score, producing "0 Faible" in red across all 8 gauge cards. Users saw red warnings on a brand-new account with no data.

**How to apply:** Any new gauge widget added to the healthMetrics grid must supply null (not 0) when the underlying data source is not connected or has no records.
