---
name: FlowPoint RLS migration status
description: Status of Supabase/PostgreSQL RLS tenant isolation after migration 012
---

## Current state (post-migration)
- 145 tables in public schema — all have RLS enabled
- 481 RLS policies (tenant_select/insert/update/delete per table)
- Policy condition: `org_id = current_setting('app.current_org_id', true)`
- Tables with org_id column: 127 (all covered by tenant policies)
- Tables without org_id: get RLS enabled but no tenant policy (service-role only)

## App impact
- The `postgres` DB user has `rolbypassrls=true` and `rolsuper=true`
- DATABASE_URL points to local helium PostgreSQL (not Supabase cloud)
- App queries as postgres bypass all RLS → zero queries broken

## Applying to Supabase cloud (not yet done)
- SUPABASE_URL = https://sejbsuuaeokyuxuoaxzd.supabase.co/rest/v1/...
- Migration file: artifacts/api-server/migrations/012_supabase_rls_tenant_isolation.sql
- Apply via: Supabase Dashboard → SQL Editor (paste the file)
- Supabase service_role key automatically bypasses RLS → app unaffected

**Why:** Without RLS, any authenticated user could cross-read other org's data via direct API calls.
**How to apply:** Set `app.current_org_id` GUC before each query in the API layer for non-service-role connections.
