-- 022_sso_providers_legacy_provider_nullable.sql
--
-- migrations/002_dashboard_tables.sql cree sso_providers avec
-- `provider TEXT NOT NULL`, un schema anterieur au contrat applicatif actuel.
-- sso-service.ts insere aujourd'hui (id, org_id, type, name, client_id,
-- issuer, enabled, default_role, created_at) et ne renseigne PAS `provider`.
-- Sur toute base issue de ces migrations historiques, la creation d'un
-- fournisseur SSO echoue donc :
--   ERROR: null value in column "provider" of relation "sso_providers"
--          violates not-null constraint   (SQLSTATE 23502)
--
-- La colonne et toutes ses donnees sont CONSERVEES : seule la contrainte
-- NOT NULL est levee, ce qui aligne les deux provenances de schema
-- (migrations SQL et init-data-tables.ts) sans rien supprimer.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sso_providers'
      AND column_name = 'provider' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.sso_providers ALTER COLUMN provider DROP NOT NULL;
  END IF;
END $$;
