---
name: AI Engine Consultant Refactor
description: Architectural rules for the FlowPoint AI consultant engine — tenant isolation, real data, format
---

# AI Engine Consultant — Architectural Rules

## Rule 1 — All AI endpoints must call `buildFlowpointContext(context, orgId)`
This function reads real DB data for the org and injects it as structured text into every AI prompt.

**Why:** Endpoints that skipped it (like the old `/ai/seo`) produced generic checklists unrelated to real scores.

## Rule 2 — `buildFlowpointContext` ORM queries must be org-scoped
Use `.where(eq(auditsTable.orgId, oid))` and `.where(eq(monitorsTable.orgId, oid))`.
Cross-tenant exposure risk if omitted — the Drizzle ORM connection uses the superuser pool.

## Rule 3 — PSI cache queries must JOIN audits on org_id
`psi_cache` has no `org_id` column. Scope via join:
```sql
JOIN audits a ON a.url = p.url AND a.org_id = $N
```

## Rule 4 — Keyword deltas: `prev_position` and `position_change` columns exist
`tracked_keywords` has both. Select them alongside `current_position` for ▲▼ delta display.

## Rule 5 — Dynamic dates — never hardcode month names
`monthNames[new Date().getMonth()]` for current period.
Month-over-month comparison: use `date_trunc('month', now())` window SQL, not a cutoff date.

## Rule 6 — `estimatedTrafficImpact` derived from severity via `deriveTrafficImpact(score, issues, speed)`
Helper lives in `mission-engine.ts`. Score < 50 or speed < 40 → high impact. Always non-null for missions with real data.

## Rule 7 — Competitor DR gap: compare DR vs DR
Never compare our SEO score (0-100) to competitor domain_rating (0-100) — different scales with different meanings.
