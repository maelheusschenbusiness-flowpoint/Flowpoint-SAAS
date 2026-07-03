---
name: init-data-tables.ts self-healing schema pattern
description: How FlowPoint api-server keeps prod schema in sync — only this file auto-runs on every boot; raw migrations/*.sql do not.
---

`artifacts/api-server/src/services/init-data-tables.ts` (plus sibling `init-rls-setup.ts`,
`init-monitors.ts`, `init-automation.ts`) runs idempotent `CREATE TABLE IF NOT EXISTS` /
`ALTER TABLE ADD COLUMN IF NOT EXISTS` statements on **every server boot, in every
environment** (confirmed empirically dev + prod). This is the only schema-sync mechanism
that actually reaches production.

**Why:** `artifacts/api-server/migrations/*.sql` (numbered files) and `pnpm run migrate`
are never wired into any automatic runner. Historically only the RLS migration got run
manually; raw table-creation migrations were written but never executed against the
production Supabase Postgres DB, causing real schema drift (missing columns/tables) that
only surfaced as production 500s — endpoints worked in every other environment.

**How to apply:** When a production-only 500 turns out to be a missing column/table, do
not assume a migration file "handles" it — check whether `init-data-tables.ts` (or the
matching `init-*.ts` for that subsystem) also creates/alters it. If not, add idempotent
`CREATE TABLE IF NOT EXISTS` / `ALTER ... ADD COLUMN IF NOT EXISTS` there — that's what
actually self-heals prod on next deploy/boot, without needing raw DB credentials or a
manual migration run. Always match column names exactly to what the route/service code
reads and writes (check `ON CONFLICT` targets too — they imply UNIQUE constraints that
must also exist).
