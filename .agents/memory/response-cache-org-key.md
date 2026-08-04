---
name: In-memory response cache must be org-keyed
description: withCache middleware leaked org-scoped API responses across tenants; cache keys must include req.orgId
---

**Rule:** Any response-caching middleware keyed on the request URL must include the tenant (`req.orgId`) in the cache key. `withCache` (middlewares/cacheControl.ts) now uses `${orgId}:${originalUrl}`.

**Why:** The cache was keyed by URL only. Org B requesting `GET /api/keywords` within the TTL received Org A's cached keyword list — a cross-tenant data leak that also made freshly added rows invisible ("stale after write"). Found via a two-org isolation QA on 2026-08-04.

**How to apply:** When adding `withCache` (or any memoization) to a new route, confirm the key includes every dimension that changes the response: org, and query string (originalUrl already covers query). Frontend reloads after mutations must still pass `{ force: true }` to `apiFetch` because the browser-side GET cache is separate.
