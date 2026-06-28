---
name: FlowPoint API route map
description: Correct API paths for all major sections — many differ from "obvious" guesses
---

# FlowPoint API Route Map

**Why:** Many routes use non-obvious names. Guessing wrong = 404 in tests.

## Confirmed correct paths (all return 200)

| Section | Correct path | Wrong guess |
|---------|-------------|-------------|
| Revenue Leak | `GET /api/revenue-leak` | ~~`/api/revenue-leaks`~~ |
| GBP Posts | `GET /api/gbp-posts` | ~~`/api/gbp/posts`~~ |
| GBP Posts list | `GET /api/gbp-posts/list` | — |
| GBP Queue | `GET /api/gbp-posts/queue` | — |
| Calendar | `GET /api/calendar-events` | ~~`/api/calendar/events`~~ |
| Review Intel | `GET /api/review-intelligence` | ~~`/api/review-intel`~~, ~~`/api/reviews`~~ |
| Review Intel reviews | `GET /api/review-intelligence/reviews` | — |
| Review Intel alerts | `GET /api/review-intelligence/alerts` | — |
| Review reputation | `GET /api/review-intelligence/reputation-score` | — |
| Conversion/CRO | `GET /api/cro` | ~~`/api/conversion`~~ |
| Local SEO citations | `GET /api/local-seo/citations` | ~~`/api/local-seo`~~ |
| SEO status | `GET /api/seo/status` | ~~`/api/seo`~~ |
| Growth / Market | `GET /api/market-intelligence` | ~~`/api/growth`~~ |
| Monitor update | `PATCH /api/monitors/:id` | ~~`PUT /api/monitors/:id`~~ |
| Settings update | `PATCH /api/me` | ~~`PUT /api/settings`~~ |
| Local Maps | `GET /api/local-maps/heatmaps` | — |
| Local Maps competitors | `GET /api/local-maps/competitors` | — |
| Local Maps opportunities | `GET /api/local-maps/opportunities` | — |
| Local Maps visibility | `GET /api/local-maps/visibility-scores` | — |
| Billing plans | `GET /api/billing/plans` | ~~`/api/billing`~~ |
| CRM status | `GET /api/crm/status` | — |
| CRM leads | `GET /api/crm/leads` | ~~`/api/crm/contacts`~~ |

## Alert-rules valid types
`seo_score | latency | uptime | monitor_down | keyword_ranking_drop`
NOT: `score_drop`

## SSE endpoints (keep connection open — timeout expected, not a bug)
- `GET /api/activity/events` — SSE stream
- `GET /api/billing/events` — SSE stream

## 400-expected (integrations not configured — correct behavior)
- `GET /api/gsc/analytics` — "No GSC site selected. POST /api/gsc/site first"
- `GET /api/ga4/overview` — "No GA4 property configured. POST /api/ga4/property first"
- `GET /api/gsc/keywords` — same

**How to apply:** Use these paths in Playwright tests, curl audits, and dashboard.js debug.
