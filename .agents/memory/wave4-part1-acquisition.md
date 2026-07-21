---
name: Wave 4 Part 1 — Acquisition routes
description: Analytics/Traffic/Campaigns dedicated backend routes + dashboard.js API modules; QA bootstrap schema notes
---

## What was built

3 thin-wrapper service files + 3 route files + dashboard.js API modules.

**Routes (all require auth, return `{ok:true,source:"ga4",data:{...}}`)**
- `GET /api/analytics/status|overview|realtime|pages|conversions|audience`
- `GET /api/traffic/status|sources|organic/keywords|organic/pages`
- `GET /api/campaigns/status` + `GET /api/campaigns/`

All delegate to `ga4-service.ts` (GA4 Data API) and `gsc-service.ts` (organic GSC data).
All registered in `routes/index.ts` via `router.use("/analytics"|"/traffic"|"/campaigns")`.

## Dashboard.js API module pattern

Added `window._fpAnalyticsAPI`, `window._fpTrafficAPI`, `window._fpCampaignsAPI` objects at IIFE module level (before `renderGA4Analytics` at ~line 27508).
Each has `loadAll(days?)` that:
1. Sets `window._fp*State = { loading: true }` → calls `render()`
2. Calls `apiFetch('/api/analytics/...')` in parallel (Promise.all)
3. Merges result into `window.FP_DATA.ga4` for backward compatibility
4. Sets state to `{ loaded: true, data, error }` → calls `render()` again

Each render function checks state first, schedules `loadAll()` on first call via `setTimeout(..., 60)`.
Skeleton helpers: `_fpAnaLoadingSkeleton / _fpAnaErrorSkeleton / _fpTraf* / _fpCamp*`.

**Why:** GA4/Traffic/Campaigns pages previously read only from preloaded `FP_DATA.ga4`. New modules allow dedicated route calls with independent loading state per section.

## QA bootstrap: organizations schema

`organizations` table columns: `id, name, slug, owner_user_id, status, plan, stripe_customer_id, stripe_subscription_id, created_at, updated_at`

No `trial_ends_at`, `email`, or `first_name` columns in local dev DB (those are Supabase/Render only).

Correct INSERT pattern:
```sql
INSERT INTO organizations(id,name,slug,owner_user_id,status,plan,created_at,updated_at)
VALUES($1,$1,$1,$1,'active','ultra',NOW(),NOW()) ON CONFLICT(id) DO NOTHING
```

Sessions use `user_sessions` (not `sessions`): `token, user_id, org_id, email, role, expires_at`

## pg import path in tests

All `.mjs` test files must use full path:
```js
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
```

## Test file

`artifacts/api-server/tests/certification/wave4_part1.mjs` — 106 tests, 14 sections.
