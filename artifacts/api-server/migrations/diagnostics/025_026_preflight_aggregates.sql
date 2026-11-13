-- 025_026_preflight_aggregates.sql  —  LECTURE SEULE, AUCUNE DONNEE PERSONNELLE
--
-- Pre-verification (go/no-go) avant 025 et 026. Ne renvoie que des compteurs et
-- des booleens : aucune adresse e-mail, aucun identifiant. Ne modifie rien.
-- Usage : psql "$DATABASE_URL" -X -f migrations/diagnostics/025_026_preflight_aggregates.sql
-- Role conseille : lecture seule (ou postgres, aucune ecriture n'est emise).
SET default_transaction_read_only = on;

SELECT 'tables_presentes' AS controle,
       (to_regclass('public.organizations') IS NOT NULL
        AND to_regclass('public.activity_logs') IS NOT NULL) AS ok,
       'organizations et activity_logs doivent exister' AS regle;

SELECT 'colonnes_attendues' AS controle,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public'
           AND ((table_name='organizations' AND column_name IN ('id','owner_email','status','subscription_status','stripe_subscription_id'))
             OR (table_name='activity_logs' AND column_name='org_id'))) = 6 AS ok,
       '5 colonnes organizations + activity_logs.org_id' AS regle;

-- 025 : doit etre 0 groupe pour que l'index soit cree (go = 0)
SELECT '025_groupes_doublons_lower_owner_email' AS controle,
       count(*) AS groupes, COALESCE(max(n), 0) AS taille_max_groupe
  FROM (SELECT count(*) n FROM organizations
         WHERE owner_email IS NOT NULL AND owner_email <> '' AND status IS DISTINCT FROM 'deleted'
         GROUP BY lower(owner_email) HAVING count(*) > 1) d;

-- Organisations hors index partiel (information, pas bloquant)
SELECT '025_hors_index' AS controle,
       count(*) FILTER (WHERE owner_email IS NULL OR btrim(owner_email) = '') AS sans_owner_email,
       count(*) FILTER (WHERE status = 'deleted') AS supprimees,
       count(*) FILTER (WHERE owner_email IS NOT NULL AND owner_email <> '' AND owner_email <> btrim(owner_email)) AS owner_email_avec_espaces,
       count(*) AS total
  FROM organizations;

SELECT '025_index_existant' AS controle,
       (SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.organizations_owner_email_active_uniq')) AS valide_ou_null_si_absent;

-- A-09 : trialing sans souscription (agrege)
SELECT 'a09_trialing_sans_souscription' AS controle,
       count(*) AS nb
  FROM organizations
 WHERE subscription_status = 'trialing'
   AND (stripe_subscription_id IS NULL OR btrim(stripe_subscription_id) = '')
   AND status IS DISTINCT FROM 'deleted';

-- 026 : etat RLS / policies de activity_logs (go si policies = 4 : 026 sera un no-op ;
-- policies = 0 : 026 les posera, conserver cet etat pour le retour arriere)
SELECT '026_etat_activity_logs' AS controle,
       c.relrowsecurity AS rls_activee, c.relforcerowsecurity AS force_rls,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='activity_logs') AS policies_total,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='activity_logs'
           AND p.policyname IN ('tenant_select','tenant_insert','tenant_update','tenant_delete')) AS policies_tenant
  FROM pg_class c WHERE c.oid = to_regclass('public.activity_logs');

-- Role de connexion courant : BYPASSRLS ou non (026 n'a d'effet que pour les non-BYPASSRLS)
SELECT 'role_connexion' AS controle, current_user AS role,
       (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) AS ignore_rls;

-- Taille et activite (duree des verrous)
SELECT 'taille' AS controle, relname, pg_size_pretty(pg_total_relation_size(oid)) AS taille, reltuples::bigint AS lignes_estimees
  FROM pg_class WHERE oid IN (to_regclass('public.organizations'), to_regclass('public.activity_logs'));

SELECT 'transactions_longues_(>1min)' AS controle, count(*) AS nb
  FROM pg_stat_activity
 WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
   AND xact_start < now() - interval '1 minute';
