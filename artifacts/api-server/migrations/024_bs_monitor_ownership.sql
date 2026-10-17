-- 024_bs_monitor_ownership.sql
--
-- Appartenance des moniteurs BetterStack. Le compte BetterStack est PARTAGE par
-- FlowPoint : l'API distante ne connait pas nos organisations et renvoie tout le
-- parc a qui demande. L'isolation ne peut donc venir que d'ici — cette table EST
-- l'autorisation.
--
-- Migration VOLONTAIREMENT AUTONOME : elle ne depend pas de la migration
-- PostgreSQL V1 et n'en fait pas partie. Elle est idempotente et peut etre
-- appliquee seule sur n'importe quel environnement.
--
-- Regle structurante : un moniteur SANS proprietaire n'appartient a personne et
-- reste inaccessible. Aucune ligne ne doit jamais etre deduite d'une demande
-- client.

CREATE TABLE IF NOT EXISTS bs_monitor_ownership (
  bs_id       TEXT        PRIMARY KEY,   -- identifiant BetterStack ; un moniteur a UN proprietaire
  org_id      TEXT        NOT NULL,
  claimed_via TEXT        NOT NULL,      -- 'created' | 'backfill_url'
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bs_own_org_idx ON bs_monitor_ownership(org_id);

ALTER TABLE bs_monitor_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_monitor_ownership FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select" ON bs_monitor_ownership;
DROP POLICY IF EXISTS "tenant_insert" ON bs_monitor_ownership;
DROP POLICY IF EXISTS "tenant_update" ON bs_monitor_ownership;
DROP POLICY IF EXISTS "tenant_delete" ON bs_monitor_ownership;

CREATE POLICY "tenant_select" ON bs_monitor_ownership FOR SELECT
  USING      (COALESCE(org_id::text, 'default') = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON bs_monitor_ownership FOR INSERT
  WITH CHECK (COALESCE(org_id::text, 'default') = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON bs_monitor_ownership FOR UPDATE
  USING      (COALESCE(org_id::text, 'default') = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON bs_monitor_ownership FOR DELETE
  USING      (COALESCE(org_id::text, 'default') = current_setting('app.current_org_id', true));
