---
name: FlowPoint team_members schema fix
description: Root cause and fix for INVITATION_DB_ERROR 500 on POST /api/team/invite
---

## Rule
`team_members.id` and `team_members.org_id` must be TEXT (not UUID) in Supabase production.

**Why:** FlowPoint intentionally uses email strings as org_ids everywhere (user_sessions,
org_settings, GUC, RLS policies). The `organizations` table (UUID PK) has no connection
to any user account. team_members was incorrectly created with UUID types via Supabase
Dashboard. UUID→TEXT migration is the correct fix.

**RLS policy:** `COALESCE(org_id::text, 'default') = current_setting('app.current_org_id')`
— the GUC is always set to the email string. UUID org_id causes the RLS comparison to fail.

**How to apply:** If team_members ever reverts to UUID types, run:
```sql
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_org_id_fkey;
ALTER TABLE public.team_members ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE public.team_members ALTER COLUMN org_id TYPE TEXT USING COALESCE(org_id::text, 'default');
```

**Local pool ≠ Supabase:** In Replit dev env, DATABASE_URL points to local postgres (heliumdb
via unix socket), not Supabase. DDL run via pool only modifies local DB. Use Supabase SQL
Editor or a deployed server startup (Render → DATABASE_URL → Supabase) for production DDL.

**Session testing production:** Insert directly into Supabase user_sessions via PostgREST
with service role key (bypasses RLS). Use `Cookie: fp_token=<token>` header.
