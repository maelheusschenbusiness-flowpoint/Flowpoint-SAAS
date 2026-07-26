---
name: pool.query() org_id audit
description: Full audit of pool.query() direct calls on tenant tables — which have org_id and which were missing it
---

# pool.query() direct calls — audit results (2026-07-26)

## Security model reminder

- `current_user = postgres`, `rolsuper=t`, `rolbypassrls=t` on Render/Supabase DB
- `FORCE ROW LEVEL SECURITY` has NO effect on postgres superuser — always bypassed
- `withOrgDb()` → `SET LOCAL ROLE app_user` IS the real isolation (app_user = non-superuser, non-BYPASSRLS)
- `pool.query()` direct = runs as postgres superuser, RLS completely bypassed, only WHERE org_id=? protects

## Column `forcedrowsecurity` on pg_tables

NOT available on this PostgreSQL version via `pg_tables`.
Use `pg_class.relforcerowsecurity` instead (JOIN pg_class ON relname=tablename).
The sentinel in `init-rls-migration.ts` was fixed to use `pg_class`.

## Routes audited — all clear after fixes

All pool.query() calls in routes now have explicit org_id in WHERE clauses:
- `monitors.ts:382` — was `WHERE id=$1`, fixed to `WHERE id=$1 AND org_id=$2`
- `audits.ts:119` — was `WHERE id=$5`, fixed to `WHERE id=$5 AND org_id=$6`
- `audits.ts:126` — was `WHERE id=$1`, fixed to `WHERE id=$1 AND org_id=$2`

All other routes (me.ts, team.ts, overview.ts, google.ts, ai.ts, funnels.ts,
connectors.ts, diagnostics.ts, admin.ts) had org_id correctly scoped.

## Why

**How to apply:** Any new pool.query() on a tenant table (one with org_id column) MUST
include `AND org_id = $N` in the WHERE clause. Never rely on RLS for pool.query() calls.
