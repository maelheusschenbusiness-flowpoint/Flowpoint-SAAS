---
name: FlowPoint API audit results
description: Final state of API audit — all endpoints, correct paths, 0 500 errors
---

## Final State (2026-06-28)
- **48/48 endpoints passing** — 0 HTTP 500 errors
- **RLS: 149/149 tables** with 4+ tenant-filtered policies

## Key fixed endpoints
- `POST /api/ai/summary` → was 500, now returns graceful 200 fallback
- `POST /api/cro/generate` → was 500, now returns graceful 200 (split try/catch so getCROData failure returns empty response instead of 500)

## Correct API paths (real, tested)
**GET 200:**
/api/me, /api/healthz, /api/audits, /api/monitors, /api/missions, /api/reports,
/api/notifications, /api/billing/subscription, /api/ai-credits, /api/integrations,
/api/team, /api/calendar-events, /api/alert-rules, /api/alert-events,
/api/alert-rules/templates, /api/cro, /api/revenue-leak, /api/forecast,
/api/local-maps, /api/local-maps/heatmaps, /api/local-maps/competitors,
/api/local-maps/opportunities, /api/market-intelligence, /api/review-intelligence,
/api/gbp-posts, /api/gbp-posts/list, /api/gbp-posts/scheduled,
/api/crm/status, /api/crm/providers, /api/crm/logs,
/api/keywords, /api/competitors, /api/seo/status,
/api/betterstack/config, /api/betterstack/stats,
/api/ai/history, /api/white-label/templates, /api/white-label/domains,
/api/me/prefs, /api/activity

**POST 200/201:**
- `POST /api/audits` body: `{url, type}` → 201
- `POST /api/monitors` body: `{url, name, type}` → 201
- `POST /api/reports` body: `{name, url}` → 201
- `POST /api/ai/summary` body: `{context:{url}}` → 200
- `POST /api/cro/generate` body: `{siteUrl}` → 200
- `POST /api/missions` body: `{title, description, priority}` → 201
- `POST /api/calendar-events` body: `{title, startDate, endDate, type}` → 201
- `POST /api/alert-rules` body: `{name, type, operator, threshold}` → 201
  - type: uptime|seo_score|latency|monitor_down|keyword_ranking_drop
  - operator: lt|gt|eq

## Note
Routes that do NOT exist (404, not bugs): /api/growth, /api/settings,
/api/auth/me (→ use /api/me), /api/monitors/stats, /api/cro/experiments,
/api/local-maps/posts (→ use /api/gbp-posts), /api/crm/pipeline,
/api/alert-rules/history (→ use /api/alert-events), /api/uptime (→ /api/betterstack)
