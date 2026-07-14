---
name: team_members name column pattern
description: How to handle the name column in team_members — removed from INSERT/SELECT/RETURNING, derived from email at read-time; migration pattern for absent vs exists-without-default.
---

## Rule
Do NOT include `name` in any INSERT, SELECT, or RETURNING clause for `team_members`. Derive display name from `email.split('@')[0]` at read-time in the response map.

## Why
The `name` column had two distinct failure modes across environments:
- **Production (Supabase pooler)**: column was absent entirely — `ALTER TABLE ADD COLUMN` silently swallowed by `run()` try/catch → INSERT failed with 42703 "column does not exist"
- **Local dev**: column existed but with NO DEFAULT (created by an older `CREATE TABLE` before `DEFAULT ''` was added) → INSERT without `name` failed with 23502 NOT NULL violation

## How to apply
- `GET /api/team`: `SELECT id, email, role, ...` — no `name` column; response adds `name: (m.email as string)?.split("@")[0] ?? ""`
- `POST /api/team/invite` INSERT: omit `name` from column list and `$N` values entirely
- `PATCH /api/team/:id` RETURNING: `RETURNING id, email, role` — derive name in response

## Migration pattern (init-data-tables.ts)
Use the two-statement pair for any column that may be absent OR present-without-default:
```sql
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ALTER COLUMN name SET DEFAULT '';
```
- First statement: adds column with DEFAULT if absent (production case)
- Second statement: sets DEFAULT on existing column with no default (local dev case)
Both are idempotent and safe inside the `run()` try/catch wrapper.
