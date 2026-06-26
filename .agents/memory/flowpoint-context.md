---
name: FlowPoint production context
description: Full 10-phase spec, mock inventory, P0/P1/P2 blockers and session outcomes
---

# FlowPoint SaaS Dashboard — Production Context

## Architecture
- SPA: `artifacts/flowpoint-export/dashboard.js` (~31,200 lines, served static)
- API: `artifacts/api-server/` (Express + TypeScript, port 8081)
- DB: Supabase PostgreSQL (MONGO_URI also available for legacy)
- Auth: JWT in localStorage (`token` + `fp_token`)

## Session outcomes (2026-06-26)

### Phase 1 — Playwright UI Audit (196 steps, all pages)
- All pages rendered without JS errors
- 0 NaN/undefined/null visible
- BUG1-5 all resolved (carried from prior session)

### Phase 2 — CRUD API Verification (10 workflows)
All verified 201 Created:
- POST /api/alert-rules  → `{name, type, operator, threshold, durationMin, channels, enabled}`
- POST /api/monitors     → `{url, name, interval, alertThreshold}` (name required!)
- POST /api/missions     → `{name, targetUrl, targetMetric, targetValue, deadline}`
- POST /api/competitors  → `{name, url}`
- POST /api/keywords     → `{keyword, url}`
- POST /api/reports      → `{name, type, siteUrl}` (field is `name` not `title`!)
- POST /api/audits       → `{url}`
- POST /api/gbp-posts    → `{locationId, locationName, content, postType, ctaType, seoKeywords}`
- POST /api/calendar-events → `{title, start, type}` (route: /api/calendar-events)
- POST /api/team/invite  → `{email, role}`
- PATCH /api/me          → settings save (not /api/settings which is 404)

### Phase 3 — RLS Migration
- File: `artifacts/api-server/migrations/010_rls_hardening.sql`
- 67 tables with `ENABLE ROW LEVEL SECURITY`
- 67 `CREATE POLICY` with `org_id = current_setting('app.current_org_id', true)`
- 20 `ADD COLUMN IF NOT EXISTS org_id`
- 18 indexes on `org_id`
- `set_org_context()` helper function

## BUG6 — Alert Rules "+" button
- **Root cause**: `addEventListener` in `afterRender()` is dead when nav re-renders DOM
- **Fix**: Added inline `onclick` to HTML template in `renderAlertRules()` (line ~7615)
- **Route**: Settings → navigateSub('alerts') → `renderAlertRules()` (line 7492)
- **NOT on alerts-center** which calls `renderAlertsCenter()` (line 19651) — different component

## Key routing facts
- `navigate('alerts-center')` → `renderAlertsCenter()` (Command Center, no "+" button)
- `navigate('settings'); navigateSub('alerts')` → `renderAlertRules()` (has "+" button)
- Calendar route: `/api/calendar-events` (not `/api/calendar`)
- Settings save: `PATCH /api/me` (not `/api/settings`)

## GBP Posts schema (post fix)
- Table columns: `location_id`, `post_type`, `cta_type`, `media_urls[]`, `seo_keywords[]`
- Frontend sends: `locationId` (camelCase) → service maps to `location_id`
- Arrays stored as native Postgres arrays (NOT JSON.stringify)
