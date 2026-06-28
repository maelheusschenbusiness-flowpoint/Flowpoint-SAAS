---
name: FlowPoint RLS migration — final state
description: Production RLS state, migration runner pattern, trigger mechanism, validation counts.
---

## Current state (local = target for production)
- 145 tables with RLS enabled, 508 tenant isolation policies
- 127 tenant tables (have org_id) → 4 policies each
- All org_id indexes exist (covered by init-data-tables.ts CREATE INDEX IF NOT EXISTS)

## Production (Supabase) — needs first-time migration run
- Only 43 tables had RLS, 10 policies; audits/notifications/competitors/connectors missing org_id
- migrations 010-013 were never applied to Supabase

## Migration runner — EXPLICIT trigger only (NOT auto-startup)

**Never runs automatically.** Must be triggered deliberately:

```bash
# Option A — npm script (builds + runs + exits)
pnpm --filter @workspace/api-server run migrate

# Option B — Render one-off job / pre-deploy hook
node --enable-source-maps ./dist/migrate.mjs
```

File: `artifacts/api-server/src/migrate.ts` → compiled to `dist/migrate.mjs`
Logic: `artifacts/api-server/src/services/init-rls-migration.ts`

**Sentinel check:** skips everything if `audits.org_id` already exists (~1ms).
**Idempotent:** safe to re-run; all DDL uses IF NOT EXISTS / IF EXISTS.

## Startup sequence (index.ts) — NO migration
initRlsSetup → initMissionsTables → initAutomationTables → initMonitorsTables → initDataTables → listen()
Zero DDL on normal boot.

## Verifying after production migration
Render logs (when migrate runs): `[rls-migration] Migration complete {rls_tables: 145, total_policies: 508}`
Or: `GET /api/admin/db-check` (x-admin-key header) → `rls.rls_enabled_tables` + `rls.total_policies`

## GUC for tenant isolation
`current_setting('app.current_org_id', true)` — set by dbContext middleware per request.

## Documentation
`artifacts/api-server/migrations/README.md` — execution order, pre/post checks, how to add migrations.
