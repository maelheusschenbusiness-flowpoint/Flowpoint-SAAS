---
name: FlowPoint API audit results
description: Complete results of 31-endpoint audit + 6 CRUD operations after full rebuild
---

## Final State (2026-06-28)
- **31/31 endpoints passing** — 100%, 0 HTTP 500 errors
- **6/6 CRUD operations** — 201 Created for all
- **RLS: 150/150 tables** with 600 tenant-filtered policies

## Correct API paths (tested, confirmed 200 OK)
**GET endpoints:**
/api/me, /api/overview, /api/audits, /api/monitors, /api/missions, /api/reports,
/api/notifications, /api/activity, /api/billing/subscription, /api/billing/plans,
/api/billing/usage-details, /api/alert-rules, /api/team, /api/team/messages,
/api/competitors, /api/keywords, /api/ga4/status, /api/gsc/status,
/api/google/status, /api/google/locations, /api/cro, /api/revenue-leak,
/api/ai-credits, /api/automation/workflows, /api/review-intelligence,
/api/market-intelligence, /api/calendar-events, /api/connectors,
/api/seo/status, /api/admin/stats, /api/admin/rls

**POST 201 CRUD:**
- `POST /api/audits` body: `{url, type: "seo"}` → 201
- `POST /api/monitors` body: `{url, name, type: "http"}` → 201
- `POST /api/missions` body: `{title, status: "todo", priority: "medium"}` → 201
- `POST /api/competitors` body: `{url, name}` → 201
- `POST /api/alert-rules` body: `{name, type, operator, threshold, channels: ["email"], enabled: true}` → 201
  - type: uptime|seo_score|latency|monitor_down|keyword_ranking_drop
  - operator: lt|gt|eq
- `POST /api/keywords` body: `{keyword, location, language}` → 201

## Endpoint path corrections (dashboard.js was already correct; test assumptions were wrong)
- `/api/team/members` → does NOT exist; correct is `/api/team`
- `/api/calendar/events` → does NOT exist; correct is `/api/calendar-events`
- `/api/settings` → no API endpoint; settings are localStorage-only

**Why:** Confirmed during T002-T006 audit cycle. Useful baseline for future regression tests.
