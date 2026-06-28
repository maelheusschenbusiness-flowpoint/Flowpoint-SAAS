---
name: FlowPoint RLS migration — final state
description: Production RLS state, migration runner pattern, and validation counts.
---

## Current state (local = target for production)
- 145 tables with RLS enabled, 508 tenant isolation policies
- 127 tenant tables (have org_id) → 4 policies each
- All org_id indexes exist (covered by init-data-tables.ts CREATE INDEX IF NOT EXISTS)

## Production (Supabase) before next deploy
- Only 43 tables had RLS, 10 policies; audits/notifications/competitors/connectors missing org_id
- migrations 010-013 were never applied to Supabase

## Migration mechanism — startup runner (NOT an HTTP endpoint)
- File: `artifacts/api-server/src/services/init-rls-migration.ts`
- Sentinel: checks if `audits.org_id` exists → skip if found (~1ms on every boot)
- First run against Supabase prod: adds org_id to ~50 tables, enables RLS on all public
  tables, drops stale policies, creates 4 policies per tenant table, grants Supabase roles
- Registered in `index.ts` after `initRlsSetup()`, before `initMissionsTables()`

**Why startup runner:** psql can't reach Supabase from Replit (port 5432 blocked).
Render server has DB access via DATABASE_URL → migration runs at next Render deploy.

## Verifying after production deploy
Render logs: `[rls-migration] Migration complete {rls_tables: X, total_policies: X, ...}`
Or: `GET /api/admin/db-check` (x-admin-key header) → `rls.rls_enabled_tables` + `rls.total_policies`

## GUC for tenant isolation
```sql
current_setting('app.current_org_id', true)
```
Set by `dbContext` middleware via `SET LOCAL app.current_org_id = $1` per request.

## Policy condition
`org_id = current_setting('app.current_org_id', true)` applied on SELECT/INSERT/UPDATE/DELETE.
Service-role key bypasses RLS entirely → app's Supabase client unaffected.
