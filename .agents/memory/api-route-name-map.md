---
name: FlowPoint API correct route paths
description: Mapping from intuitive names to actual API paths — prevents 404 test failures
---

# FlowPoint API Route Name Map

## Routes that have different names than expected

| Intuitive name | Actual path | Route file |
|---|---|---|
| settings | `/api/me` (GET/PATCH) | me.ts |
| local-seo | `/api/local-maps` | local-maps.ts |
| conversions / CRO | `/api/cro` | cro.ts |
| audit-schedules | `/api/audits/schedules` | audits.ts |
| analytics (GSC) | `/api/gsc/analytics` | gsc.ts |
| analytics (GA4) | `/api/ga4/overview` | ga4.ts |
| growth / revenue | `/api/revenue-leak` | revenue-leak.ts |
| review intelligence | `/api/review-intelligence` | review-intelligence.ts |
| GBP posts | `/api/gbp-posts` | gbp-posts.ts |

## Routes with NO root GET (sub-routes only — not bugs)
- `/api/pagespeed` → use `/api/pagespeed/analyze` (POST) or `/api/pagespeed/opportunities`
- `/api/automation` → use `/api/automation/workflows` or `/api/automation/runs`
- `/api/billing` → use `/api/billing/plans`, `/api/billing/subscription`, `/api/billing/config`
- `/api/crm` → use `/api/crm/status`, `/api/crm/leads`, `/api/crm/logs`

## Alert-rules valid types
`seo_score | latency | uptime | monitor_down | keyword_ranking_drop`  
(NOT `audit_score` — that type does not exist)

## Monitors POST alertEmail constraint
`alertEmail` field CANNOT be set unless `ALERT_EMAIL` env var is configured on the server.
In dev/test: send `alertEmail: ""` (empty string) to bypass the check.

**Why:** Documented during API sweep to prevent false 404 alerts and wrong CRUD test failures.
