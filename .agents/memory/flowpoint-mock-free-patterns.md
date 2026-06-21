---
name: FlowPoint mock-free rendering patterns
description: Canonical patterns for eliminating hardcoded/fake data from each dashboard section; use these when adding new data to any section.
---

## Billing — usage rows
- `const _ud = STATE.usageDetails || {};` at top of renderBilling
- Rows with no server instrumentation: `v: _ud.someMetric, max: X, na: _ud.someMetric == null`
- Render guard: `if (u.na) return <"Non instrumenté" card>;` at top of `usages.map`
- `criticalUsages` filter must also guard: `!u.na && u.v!=null && u.max>0`
- `healthScore` computed from live pcts only; `usageHealth = healthScore ?? 0` for SVG safety
- SVG text: `${healthScore!=null?usageHealth:'—'}`; statCards use `displayStat()`

**Why:** Hardcoded numbers (2.4GB, 3280 API calls, etc.) appeared as real metrics in production. `na:true` pattern shows a greyed "Non instrumenté" card instead.

## Local SEO — all computed vars
- `const _lseo = STATE.localSeo || {};` at top of renderLocalSEO
- `domScore = _lseo.domScore ?? (PREVIEW_MODE ? 72 : null)`
- `cities = _lseo.cities?.length ? _lseo.cities : (PREVIEW_MODE ? _lseoPreviewCities : [])`
- `forecasts = _lseo.forecasts?.length ? _lseo.forecasts : (PREVIEW_MODE ? [...] : [])`
- `maxForecast = forecasts.length > 0 ? Math.max(...) : 1` (safe when empty)
- `zones/gbpStats` in sub 'local': same pattern with `_lseo.zones/gbpStats`
- KPI statCards: `displayStat(val!=null?val+'/100':null,'fallback')` not `val+'/100'` directly

**Why:** Lyon/Liège/etc. hardcoded city rows showed as if they were real ranking data in prod.

## Conversion — behavioral arrays
All behavioral arrays use: `STATE.behavioral?.X || (PREVIEW_MODE ? [...hardcoded...] : [])`
- `funnelSteps`: `STATE.ga4?.funnelSteps || STATE.analytics?.funnelSteps || (PREVIEW_MODE ? [...] : null)`
- funnelSteps can be **null** in prod — every `.map()` call must guard: `funnelSteps && funnelSteps.length > 0 ? funnelSteps.map(...) : <connect-CTA>`
- `mobileSteps`, `friction`: `STATE.behavioral?.X || (PREVIEW_MODE ? [...] : [])`
- `ctas`, `abIdeas`, `trustIssues`: same pattern

**Why:** Hardcoded funnel bars (12 400 impressions, 1 488 clics, etc.) showed as real analytics. Empty state with "Connect GA4" CTA is correct for prod without analytics.

## AI Workspace Intelligence — systems[]
- Use `_mkSysScore/_mkSysStatus/_mkSysColor` helpers (defined at top of sub 'intelligence')
- Each system: compute live score from STATE (audits avgScore, monitors down ratio, conversionRate×30, etc.)
- `PREVIEW_MODE ? Math.floor(Math.random()*25)+55 : null` fallback for unknown scores
- SVG dasharray: `(sys.score??0)/100*circ` to prevent NaN; text: `sys.score??'—'`

**Why:** Hardcoded scores (74, 61, 68, etc.) implied real system health that wasn't measured.

## Competitors — comps fallback
- Fake "Concurrent A/B/C" placeholder rows: now `PREVIEW_MODE ? [...] : []`
- No real-looking fake competitors shown in production

## STATE keys populated by loadData
- `STATE.usageDetails` — from `/api/billing/usage-details` (reports, team members; null for untracked)
- `STATE.localSeo` — future GBP/DataForSEO API (currently empty object `{}` in prod)
- `STATE.behavioral` — future behavioral analytics (currently empty object `{}` in prod)
- `STATE.ga4` / `STATE.analytics` — future GA4 integration (currently null in prod)
