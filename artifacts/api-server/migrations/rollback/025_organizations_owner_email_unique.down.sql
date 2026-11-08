-- Retour arriere de 025 : supprime l'index unique partiel. Ne touche a aucune donnee.
-- Reversible et idempotent. Verrou bref (ACCESS EXCLUSIVE) : lock_timeout 5 s.
SET lock_timeout = '5s';
DROP INDEX IF EXISTS public.organizations_owner_email_active_uniq;
