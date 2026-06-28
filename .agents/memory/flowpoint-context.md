---
name: FlowPoint production context
description: Full audit status, API routes, and CRUD verification results
---

# FlowPoint Production Context

## Server
- `localhost:8081`
- Token: `curl -s -X POST http://localhost:8081/api/auth/dev-session -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" -d '{}'`

## Audit Status (June 2026)
All 29 page-level GET endpoints → 200.
All 13 CRUD entities verified POST/PATCH/DELETE.

## Correct Route URLs (not obvious)
- Review Intelligence: `/api/review-intelligence` (NOT `/api/review-intel`)
- Calendar events: `/api/calendar-events` (NOT `/api/calendar/events`)
- Local SEO: no top-level `/api/local-seo` — use `/api/local-seo/citations`
- GBP posts: `/api/gbp-posts` requires `locationId` + `content` fields

## CRUD field requirements (from validation code)
- competitors POST: requires `name` + `url` (NOT `domain`)
- alert-rules POST: requires `name, type, operator, threshold`; type must be one of `seo_score|latency|uptime|monitor_down|keyword_ranking_drop`
- monitors POST: requires `name` + `url`; alertEmail now accepts any valid email
- gbp-posts POST: requires `locationId` + `content`

## Known nulls (by design)
- Overview: traffic/conversions/revenue/conversionScore/seoTrendDelta/organicGrowthPct = null (GA4 not connected)
- Billing: status = null (Stripe not connected in dev)
- CRO/forecast: empty (no analytics data)
- CRM: hubspot "connected" with seeded test token tok_test_hs_abc123 (DB data, not code bug)

## Bugs fixed
1. createHeatmap: column `location` → `center_lat`, `center_lng`, `radius_km`, `location_id`, `grid_size` (integer)
2. validateAlertEmail: removed ALERT_EMAIL env constraint — now accepts any valid email regex
3. AI credits withOrgDb: creditsLimit 0→100000 (RLS context fix)
