---
name: Rate limit GET exemption
description: Authenticated GET requests must bypass globalRateLimit; dashboard loads ~60 GETs per loadData()
---

## Rule
In `rateLimiter.ts → globalRateLimit`, skip the rate limit counter for any request where `req.method === 'GET'` AND `orgId !== 'default'` (i.e. the user is authenticated).

**Why:** The FlowPoint dashboard calls ~60 GET endpoints on every `loadData()` run (phases 2–5). The global rate limiter applies to ALL `/api/*` routes. At 120 req/min (old default) this was easily exceeded by normal navigation (each section navigation triggers additional section-specific loads of 3–5 endpoints). Even 600/min can be hit by aggressive use or multiple tabs.

**How to apply:** Add this guard at the TOP of `globalRateLimit()` before any counter increments:
```typescript
const orgId = getOrgId(req);
if (req.method === 'GET' && orgId !== 'default') { next(); return; }
```
Rate-limit only: writes (POST/PUT/PATCH/DELETE), unauthenticated GETs (orgId='default').

## Also fixed (same session)
- `apiFetch` in dashboard.js: 30-second GET dedup/result cache (`_apiFetchInFlight` Map + `_apiFetchCache` Map). Concurrent identical GETs share one Promise; subsequent calls within 30s return cached result. Writes bypass cache entirely.
