---
name: Router catch-all plan gate pattern
description: router.use(requireFeature()) with no path prefix acts as a catch-all that intercepts every unmatched route reaching that router, converting 404s to 403s for low-plan accounts.
---

## The Rule

Every `router.use(requireFeature(...))` or `router.use(requirePlan(...))` **must** include a path prefix matching the routes it protects.

```typescript
// ❌ WRONG — catches ALL unmatched routes reaching this router
router.use(requireFeature("behavioralAI", "Behavioral AI"));

// ✅ CORRECT — only intercepts /behavioral/* paths
router.use("/behavioral", requireFeature("behavioralAI", "Behavioral AI"));
```

**Why:** In Express, `router.use(middleware)` with no path matches every request that reaches the router, not just the routes defined below it. When this router is mounted without a prefix in `index.ts` (`router.use(featureRouter)`), the middleware runs for every path that wasn't handled by earlier routers — turning every 404 into a plan-gate 403.

**How to apply:** Before adding any `router.use(requireFeature(...))` or `router.use(requirePlan(...))`, confirm the call has a path prefix that matches only the guarded routes.

## Files Fixed (2026-07-29)

Four routers had this bug — all mounted path-less in `routes/index.ts` at lines 199–202:

| File | Old | Fixed |
|---|---|---|
| `routes/behavioral.ts:375` | `router.use(requireFeature("behavioralAI", ...))` | `router.use("/behavioral", ...)` |
| `routes/cro.ts:15` | `router.use(requireFeature("cro", ...))` | `router.use("/cro", ...)` |
| `routes/revenue-leak.ts:13` | `router.use(requireFeature("cro", ...))` | `router.use("/revenue-leak", ...)` |
| `routes/forecast.ts:9` | `router.use(requireFeature("forecastingAI", ...))` | `router.use("/forecast", ...)` |

**Impact before fix:** 26+ route files mounted after line 199 in `index.ts` (googleRouter, seoRouter, ga4Router, gscRouter, pagespeedRouter, githubRouter, betterstackRouter, diagnosticsRouter, locationRouter, and more) all returned 403 "Behavioral AI requires pro plan" for Standard/canceled plan accounts.

## Validation Result (local, Standard plan session)

- Previously blocked routes (`/api/google/status`, `/api/ga4/status`, `/api/gsc/status`, `/api/local-seo/citations`, `/api/seo/status`, `/api/github/status`) → 200 ✅  
- Undefined routes (`/api/team-members`, `/api/settings`) → 404 (not 403) ✅  
- Plan gates still active (`/api/behavioral/insights`, `/api/cro`, `/api/revenue-leak`, `/api/forecast`) → 403 ✅  
- Routes before behavioral still 200 ✅
