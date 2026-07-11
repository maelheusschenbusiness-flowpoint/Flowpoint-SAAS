---
name: AI Engine Consultant Refactor
description: Architectural rules for the FlowPoint AI consultant engine — tenant isolation, real data, format rules
---

# AI Engine Consultant Rules

## Rule 1 — Always call `buildFlowpointContext` before any AI prompt
Every AI endpoint must call `buildFlowpointContext(context, orgId)` before constructing its prompt. This function reads real DB data (audits, keywords, competitors, PSI, monitors) and injects it as structured text.

**Why:** The old engine produced generic checklists because endpoints like `/ai/seo` built prompts without DB data.
**How to apply:** Add to any new AI endpoint before the OpenAI call.

## Rule 2 — PSI cache queries must be scoped to org via audits join
`psi_cache` has no `org_id` column (global URL cache). To prevent cross-tenant data leaks, always JOIN with `audits`:
```sql
SELECT p.url, p.critical_issues
FROM psi_cache p
JOIN audits a ON a.url = p.url AND a.org_id = $2
WHERE p.url = ANY($1) AND p.strategy = 'mobile'
```
**Why:** Querying `psi_cache` by URL alone can expose another tenant's data if URLs coincide.

## Rule 3 — Keyword deltas available via `prev_position` + `position_change` columns
`tracked_keywords` has `prev_position` (number|null) and `position_change` (number|null, positive = improved). Include these in keyword context for delta arrows (▲/▼).

## Rule 4 — Dynamic dates in prompts — never hardcode month strings
Use `new Date()` and `monthNames[now.getMonth()]` for the current period. Month-over-month DB comparison:
```sql
SELECT
  (SELECT ROUND(AVG(score)) FROM audits WHERE org_id=$1 AND created_at >= date_trunc('month', now())) AS avg_current,
  (SELECT ROUND(AVG(score)) FROM audits WHERE org_id=$1 AND created_at >= date_trunc('month', now() - INTERVAL '1 month') AND created_at < date_trunc('month', now())) AS avg_prev
```
**Why:** Hardcoded "Mai 2026" became stale immediately.

## Rule 5 — `estimatedTrafficImpact` derives from real severity
Use `deriveTrafficImpact(score, issues, speed)` helper in `mission-engine.ts`:
- score < 50 or speed < 40 → ~15 + issues×1.5 %
- score 50-70 or speed < 60 → ~8 + issues %
- score ≥ 70 but issues > 3 → ~3 + issues×0.5 %

## Rule 6 — Competitor DR gap must compare DR vs DR (not SEO score vs DR)
Show top competitor DR vs second competitor DR. Never compare our audit score (0-100 SEO) vs competitor DR (0-100 domain rating) — different scales.
