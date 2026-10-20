-- Migration 017 — Drop spurious users_id_fkey FK (conditional)
--
-- Context:
--   On deployments originally seeded from a Supabase pg_dump, the table
--   public.users was created with:
--     CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
--   Render runs vanilla PostgreSQL with no Supabase Auth service, so
--   auth.users does not exist and any INSERT into public.users with a
--   fresh UUID raises:
--     ERROR 23503 — insert or update on table "users" violates foreign key
--     constraint "users_id_fkey"
--
-- Prerequisite:
--   Confirm via [SCHEMA-DIAG] startup log that the constraint definition
--   is exactly:
--     FOREIGN KEY (id) REFERENCES auth.users(id)
--   Do NOT apply if it references a different table — investigate first.
--
-- Application:
--   Run manually against the Render PostgreSQL once the definition is
--   confirmed, OR apply via the migration runner if one exists.
--   IF NOT EXISTS / IF EXISTS guards make this idempotent.
--
-- Safe to re-run: ALTER TABLE ... DROP CONSTRAINT IF EXISTS is a no-op
-- when the constraint is already absent.

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_id_fkey;
