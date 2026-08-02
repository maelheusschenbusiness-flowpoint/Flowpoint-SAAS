---
name: Partie A — RLS + FK infra fixes (2026-08-02)
description: 5 Supabase/Render warnings fixed by adding inline ENABLE RLS and FK drops in init files; pattern for future table additions
---

## Problem pattern

On the slow boot path: `runRlsMigrationIfNeeded` executes BEFORE `initDataTables` and `initAgentTables`. Tables created by those init files don't exist yet when RLS migration runs → they get RLS only on the next boot (if the sentinel is reset). If sentinel says "all done", they never get RLS.

**Fix:** Add `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` inline right after each `CREATE TABLE IF NOT EXISTS` in the respective init file. Idempotent, runs on every boot.

## Tables fixed

- `schema_migrations` (init-data-tables.ts): ENABLE RLS + NO FORCE + REVOKE FROM anon/authenticated; also added to BACKEND_ONLY_TABLES in init-rls-migration.ts
- `activity_logs` (init-data-tables.ts): ENABLE RLS + NO FORCE inline after self-healing ALTERs
- `ai_chat_history` (init-agent-tables.ts): added to the existing RLS loop (ENABLE + NO FORCE + 4 tenant policies)

## FK / type mismatch pattern

`ALTER TABLE organizations ALTER COLUMN id TYPE TEXT` fails silently if FK constraints reference that column. Must drop FKs FIRST (in the same DO $$ block, before the ALTER).

FKs to drop before organizations.id UUID→TEXT conversion:
- org_addons_org_id_fkey
- org_settings_org_id_fkey
- org_checklist_org_id_fkey
- org_secrets_org_id_fkey
- team_members_org_id_fkey

Also: org_addons.org_id may be UUID if created before organizations.id was TEXT. Add a separate guard to convert org_addons.org_id UUID→TEXT + drop its FK.

## Rule for future tables

Any new table added in init-data-tables.ts or init-agent-tables.ts MUST have `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` inline (right after CREATE TABLE IF NOT EXISTS). Do not rely on init-rls-migration.ts to catch it.
