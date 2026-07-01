---
name: RLS sentinel bug — org_id vs rowsecurity check
description: init-rls-migration.ts sentinel must check rowsecurity=true, not org_id column presence
---

## Rule
The sentinel in `init-rls-migration.ts` must check if RLS is actually enabled:
```sql
SELECT 1 FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'audits' AND rowsecurity = true
```
NOT: checking `information_schema.columns` for `audits.org_id`.

**Why:** Tables are created with `org_id` from day one (in the CREATE TABLE DDL). Checking `org_id` column presence is always TRUE on a fresh Supabase database → sentinel fires immediately → migration returns "Already applied" → RLS is NEVER enabled → Supabase dashboard shows all tables as "RLS Disabled" and reports a security alert.

**How to apply:** Any future "has this migration run?" sentinel for RLS should check `pg_tables.rowsecurity = true`, not column presence. The migration steps are idempotent (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS`) so re-running is safe.

## Effect
On next Render deploy, `runRlsMigrationIfNeeded()` will detect `rowsecurity = false` on audits → run the full migration → enable RLS on all 150 tables + create 4 tenant isolation policies per table.
