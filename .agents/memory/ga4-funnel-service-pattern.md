---
name: GA4 funnel v1alpha service
description: Pattern for configurable GA4 funnel reports; QA override; google_tokens unique constraint
---

## GA4 v1alpha runFunnelReport

- Endpoint: `POST ${GA4_FUNNEL_BASE}/${propertyId}:runFunnelReport`
- Default base: `https://analyticsdata.googleapis.com/v1alpha/properties`
- Configurable via `process.env['GA4_FUNNEL_BASE_URL']` at startup, or `setGA4FunnelBaseUrl(url)` at runtime
- QA endpoint: `POST /api/qa/ga4-funnel-base-url` — redirects the live service to a mock HTTP server
  - Requires valid session token (Bearer) — behind requireAuth

## google_tokens unique constraint
- Constraint is `UNIQUE(org_id, account_id)` — NOT `UNIQUE(org_id)` alone
- ON CONFLICT must use `(org_id, account_id)` as the target
- DELETE+INSERT or correct ON CONFLICT clause required in tests

## Files created
- `src/services/ga4-funnel-service.ts` — service, cache (10min TTL, orgId-keyed), allowlists, buildGA4FunnelRequest export
- `src/routes/funnels.ts` — GET/POST/GET:id/PATCH/DELETE/POST:id/run
- Tables: `funnels` + `funnel_steps` added in init-data-tables.ts (appended at end, full RLS + FORCE)

**Why:** v1alpha is separate from v1beta runReport; propertyId always from server DB (getStoredProperty), never client input; cache keys include orgId prefix for tenant safety.
