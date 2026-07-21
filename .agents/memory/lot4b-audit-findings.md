---
name: Wave 4 Lot 4B — Funnels & Conversion Audit
description: P0/P1 findings from the Lot 4B read-only audit (SHA 320df44). Critical RLS, mock data, and service isolation issues.
---

# Lot 4B Audit — Critical Findings

**SHA:** 320df4486e1bf104782b46e70cd8749a3b0b0492  
**Full report:** `.local/audits/wave4_lot4b_funnels_conversion_audit.md`

## P0 — Must-fix before certification

1. **`behavior_events` + `behavior_sessions` + `traffic_losses`** — RLS policies use `USING=(true)`, no `org_id` column → cross-tenant SELECT for all authenticated users. Fix: add `org_id` column, migrate policies.

2. **`getRevenueLeakData(siteUrl)`** — `siteUrl` parameter is received but NOT applied to the DB query (`db.select().from(revenueLeaksTable).limit(50)` with no where). Also uses superuser pool `db` bypassing RLS.

3. **`getCROData()` + `getBehaviorInsights()`** — use superuser Drizzle `db` pool, bypassing RLS. Should use `req.orgDb` or inject GUC-gated pool.

## P1 — Must-fix for metric integrity

4. **Funnel steps 2-5 (renderGA4Funnels)** — `Math.round(_funnelBase * [0.74,0.52,0.31,0.14])` — fixed industry averages, not user data. GA4 Exploration API (`runFunnelReport`) would be required for real step data.

5. **renderConversion — 27 PREVIEW_MODE occurrences** — mobileSteps, friction, scrollData, clicks, mobileChecks, ctas, abIdeas, trustIssues, experiments, all stat subtitles are hardcoded demo data. Empty state when non-PREVIEW is clean (correct).

6. **`generateCRORecommendations`** — consumes AI credits (`consumeAICredits`) but inserts only from 6 static `CRO_ISSUE_TEMPLATES` (no OpenAI call). Score formula: `100 - highCount*12 - medCount*5`.

7. **`funnelData: []` and `abTests: []` hardcoded** in every `/api/cro` response — features incomplete.

## Tables absent from DB

`funnels`, `funnel_steps`, `funnel_events`, `conversion_events`, `conversion_goals`, `experiments`, `campaigns`, `orders` — none exist.

## What IS real

- `/api/ga4/funnels` landing pages + conversion paths → real GA4 data (landing page sessions/bounceRate/conversions, sourceMedium/campaign conversions)  
- `/api/ga4/conversions` → real GA4 isConversionEvent events  
- Behavioral ingestion (POST /behavioral/token|event|session) → HMAC-SHA256 + nonce + replay guard — robust  
- `behavior_site_tokens`, `cro_recommendations`, `cro_scores`, `revenue_leaks` → org_id RLS correct  
- Plan gates: CRO requires `requireFeature("cro")`, behavioralAI requires `requireFeature("behavioralAI")`

## Key type anomaly

`cro_recommendations.ai_generated` is `text` ("true"/"false") not `boolean`.
