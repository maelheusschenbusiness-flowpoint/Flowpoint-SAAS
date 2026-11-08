-- 026_rls_activity_logs_tenant_policies.sql  (C-08)
--
-- CONTEXTE
--   `activity_logs` porte `org_id` et RLS y est activee (init-data-tables.ts), mais
--   les 4 policies tenant_* ne sont posees que par `runRlsMigrationIfNeeded()`
--   (init-rls-migration.ts), qui ne tourne PAS sur le chemin rapide de demarrage
--   (celui de la production). Une base demarree uniquement par ce chemin peut donc
--   avoir `activity_logs` avec RLS activee et AUCUNE policy : refus total pour tout
--   role soumis a RLS (anon, authenticated, app_user), sans effet pour le role de
--   connexion BYPASSRLS qu'utilise le serveur.
--
-- PORTEE VOLONTAIREMENT MINIMALE
--   - Seule `activity_logs` est traitee : c'est la seule table de la liste « RLS sans
--     policy » qui porte une dimension d'organisation (`org_id`) ET que le code lit via
--     `req.orgDb`.
--   - NON traitees (par conception, voir docs C-08 / tables-pre-compte-rls-db.test.ts) :
--       pending_signups, magic_link_tokens, checkout_subscription_claims,
--       checkout_post_tokens, schema_migrations, funnel_events  -> tables pre-compte /
--       infrastructure, backend seul : le refus par defaut est le comportement voulu ;
--       organizations, users -> cle d'organisation = `id`, semantique a valider avant
--       d'y poser une policy ;
--       seller_financial_ledger -> hors perimetre (chantier LEDGER).
--
-- SURETE
--   - Idempotent : ne cree une policy que si elle n'existe pas deja.
--   - N'altere ni RLS, ni FORCE, ni les donnees. Le serveur (role de connexion
--     BYPASSRLS) n'est pas affecte.
--   - Meme definition que init-rls-migration.ts (GUC encapsule dans un SELECT).
--
-- A APPLIQUER (hors CI, sur decision humaine) : psql "$DATABASE_URL" -f 026_...sql
--
-- VERROUS
--   CREATE POLICY prend un verrou ACCESS EXCLUSIVE tres bref sur activity_logs ;
--   lock_timeout = 5 s evite de bloquer les ecritures derriere un verrou long.
--
-- ROLES / GUC
--   Les policies n'ont pas de clause TO (PUBLIC) : aucun role n'est reference, donc
--   rien a creer sur Supabase. Le GUC `app.current_org_id` est personnalise (nom
--   pointe) : current_setting(..., true) renvoie NULL s'il n'est pas defini, donc la
--   comparaison est fausse et l'acces est REFUSE (comportement sur par defaut). Les
--   roles BYPASSRLS (postgres, service_role, supabase_admin) ignorent ces policies.
--   ATTENTION : si le serveur se connecte avec un role NON BYPASSRLS, il doit poser
--   `app.current_org_id` (req.orgDb) avant toute lecture, sinon 0 ligne.
--
-- RETOUR ARRIERE (script teste : migrations/rollback/026_rls_activity_logs_tenant_policies.down.sql)
--   A n'utiliser que si, AVANT 026, les policies etaient absentes (sinon 026 etait un
--   no-op et supprimer les policies retirerait celles posees par le demarrage).
--   DROP POLICY IF EXISTS tenant_select ON public.activity_logs;
--   DROP POLICY IF EXISTS tenant_insert ON public.activity_logs;
--   DROP POLICY IF EXISTS tenant_update ON public.activity_logs;
--   DROP POLICY IF EXISTS tenant_delete ON public.activity_logs;

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.activity_logs') IS NULL THEN
    RAISE NOTICE 'activity_logs absente : rien a faire';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'activity_logs' AND column_name = 'org_id'
  ) THEN
    RAISE NOTICE 'activity_logs sans org_id : rien a faire';
    RETURN;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.activity_logs'::regclass) THEN
    RAISE NOTICE '026: RLS DESACTIVEE sur activity_logs : les policies seront posees mais inertes (cette migration n''active pas RLS)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'tenant_select') THEN
    CREATE POLICY tenant_select ON public.activity_logs FOR SELECT
      USING (COALESCE(org_id, 'default') = (SELECT current_setting('app.current_org_id', true)));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'tenant_insert') THEN
    CREATE POLICY tenant_insert ON public.activity_logs FOR INSERT
      WITH CHECK (COALESCE(org_id, 'default') = (SELECT current_setting('app.current_org_id', true)));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'tenant_update') THEN
    CREATE POLICY tenant_update ON public.activity_logs FOR UPDATE
      USING (COALESCE(org_id, 'default') = (SELECT current_setting('app.current_org_id', true)));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'tenant_delete') THEN
    CREATE POLICY tenant_delete ON public.activity_logs FOR DELETE
      USING (COALESCE(org_id, 'default') = (SELECT current_setting('app.current_org_id', true)));
  END IF;
END $$;
