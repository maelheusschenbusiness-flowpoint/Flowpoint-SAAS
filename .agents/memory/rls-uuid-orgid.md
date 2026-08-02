---
name: RLS UUID org_id tables
description: 4 tables have UUID-typed org_id — require special comparison operator in RLS policies
---

## Rule
Tables with a UUID `org_id` (including the AI billing tables) require a special comparison operator in RLS policies. Standard RLS policy `USING (org_id = current_setting('app.current_org_id', true))` fails with "no operator matches" because `current_setting()` returns `text`.

**Fix:** Use `USING (org_id::text = current_setting('app.current_org_id', true))` — cast org_id to text for comparison.

**Why:** These tables were created with UUID org_id rather than text. In dev, `app.current_org_id` is set to 'default' (not a valid UUID), so `::uuid` cast would also fail. `org_id::text` comparison works for both dev ('default' = no match, safe) and production (UUID string = correct match).

**How to apply:** Whenever creating RLS policies on new tables, first check `org_id` column type via `information_schema.columns`. If `data_type = 'uuid'`, use the `::text` cast form. If `data_type = 'text'`, use direct comparison. For a `TEXT → UUID` conversion on an RLS table, drop only the policies that reference `org_id`, remove the incompatible default/FK, cast safely, then recreate the FK and policies in the same transactional migration.

## psql gotcha
When running multiple `CREATE POLICY` statements in a single heredoc/psql session, the first failure aborts the entire transaction — subsequent statements silently do nothing. Always run each policy in its own psql call (`-c "..."`) or wrap each in a `DO $$BEGIN ... EXCEPTION WHEN duplicate_object ...$$` block.
