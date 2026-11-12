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

-- Les policies sont creees SI ELLES MANQUENT. Un DROP suivi d'un CREATE
-- laisserait, entre les deux, une table avec RLS active et AUCUNE policy :
-- fail-closed, donc jamais une fuite, mais un demarrage non deterministe des
-- que deux instances s'executent en meme temps.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('tenant_select', 'FOR SELECT USING      (COALESCE(org_id::text, ''default'') = current_setting(''app.current_org_id'', true))'),
      ('tenant_insert', 'FOR INSERT WITH CHECK (COALESCE(org_id::text, ''default'') = current_setting(''app.current_org_id'', true))'),
      ('tenant_update', 'FOR UPDATE USING      (COALESCE(org_id::text, ''default'') = current_setting(''app.current_org_id'', true))'),
      ('tenant_delete', 'FOR DELETE USING      (COALESCE(org_id::text, ''default'') = current_setting(''app.current_org_id'', true))')
    ) AS t(nom, clause)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'bs_monitor_ownership' AND pol.polname = p.nom
    ) THEN
      BEGIN
        EXECUTE format('CREATE POLICY %I ON bs_monitor_ownership %s', p.nom, p.clause);
      EXCEPTION WHEN duplicate_object THEN
        NULL;   -- un autre appelant vient de la creer : resultat voulu
      END;
    END IF;
  END LOOP;
END $$;
