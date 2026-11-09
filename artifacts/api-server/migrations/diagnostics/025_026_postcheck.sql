-- 025_026_postcheck.sql  —  LECTURE SEULE, sans donnee personnelle.
-- A lancer apres 025 puis apres 026. Usage : psql "$DATABASE_URL" -X -f ...
SET default_transaction_read_only = on;
SELECT '025_index' AS controle, i.indisvalid AS valide, i.indisunique AS unique_,
       pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i WHERE i.indexrelid = to_regclass('public.organizations_owner_email_active_uniq');
SELECT '026_policies_tenant' AS controle, policyname, cmd
  FROM pg_policies WHERE schemaname='public' AND tablename='activity_logs' AND policyname LIKE 'tenant\_%'
 ORDER BY policyname;
SELECT '026_rls' AS controle, relrowsecurity AS rls_activee, relforcerowsecurity AS force_rls
  FROM pg_class WHERE oid = to_regclass('public.activity_logs');
SELECT 'lignes' AS controle, (SELECT count(*) FROM organizations) AS organizations,
       (SELECT count(*) FROM activity_logs) AS activity_logs;
