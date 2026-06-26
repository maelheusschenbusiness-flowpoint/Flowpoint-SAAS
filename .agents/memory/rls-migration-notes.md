---
name: RLS migration 010 execution notes
description: Lessons from executing migration 010_rls_hardening.sql on Replit PostgreSQL
---

## Rule
When running RLS migrations that use Supabase-specific roles (anon, authenticated, service_role) on Replit PostgreSQL, the roles must be created first or the policy statements will fail.

**Why:** Replit PostgreSQL only has the `postgres` superuser role by default. No Supabase-compatible roles exist.

**How to apply:** Add an idempotent DO block before the RLS section:
```sql
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roles$;
```

## Rule
`DROP POLICY IF EXISTS` produces NOTICE-level output in PostgreSQL that goes to stderr. The `executeSql` tool treats any stderr output as a failure (even NOTICEs). Fix: prepend `SET client_min_messages = WARNING;` to suppress NOTICEs.

**Why:** The tool's exit code check includes stderr content. NOTICEs are below WARNING severity so they are suppressed.

**How to apply:** First statement of any multi-statement DDL script that may DROP IF NOT EXISTS: `SET client_min_messages = WARNING;`

## Rule
`CREATE OR REPLACE POLICY` does NOT exist in PostgreSQL (as of PG 16). Use DROP POLICY IF EXISTS + CREATE POLICY.

## Final state (executed)
- 66 tables with RLS enabled + FORCE ROW LEVEL SECURITY
- 60 `rls_org_isolation` policies (tenant tables, USING org_id = app.current_org_id GUC)
- 6 `rls_deny_anon` policies (behavior_events, behavior_sessions, behavior_insights, behavior_site_tokens, magic_link_tokens, share_tokens)
- `set_org_context(TEXT)` function created, GRANT EXECUTE TO authenticated
- `crm_field_mappings` needed `org_id` added separately (was missing from STEP 1)
- API connects as `postgres` superuser → bypasses RLS; no query regressions
- 2 pre-existing 404s unrelated to RLS: /api/billing, /api/crm/integrations (routes not implemented)
