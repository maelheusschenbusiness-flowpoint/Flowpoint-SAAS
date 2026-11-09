-- backup_025_026.sql — SAUVEGARDE LOGIQUE DE REPLI (a executer par le proprietaire).
--
-- A utiliser SEULEMENT si pg_dump n'est pas possible (voir docs/MIGRATIONS-025-026-RUNBOOK.md).
-- Copie les lignes dans des tables horodatees. 025/026 ne modifient aucune ligne : cette
-- sauvegarde protege surtout contre une erreur humaine pendant le traitement des doublons.
-- CES TABLES CONTIENNENT DES DONNEES PERSONNELLES (owner_email) : RLS activee ci-dessous,
-- aucun droit pour anon/authenticated, a SUPPRIMER apres validation.
--
-- Usage : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v suffix=20261108 -f backup_025_026.sql
--   (suffix : AAAAMMJJ, lettres/chiffres/_ uniquement)
\set t_org 'bak_organizations_' :suffix
\set t_al 'bak_activity_logs_' :suffix
\set t_pol 'bak_activity_logs_policies_' :suffix
BEGIN;
CREATE TABLE public.:"t_org" AS TABLE public.organizations;
CREATE TABLE public.:"t_al"  AS TABLE public.activity_logs;
-- Definition des policies / etat RLS d'activity_logs (pour le retour arriere de 026)
CREATE TABLE public.:"t_pol" AS
  SELECT policyname, permissive, roles::text AS roles, cmd, qual, with_check,
         (SELECT relrowsecurity FROM pg_class WHERE oid='public.activity_logs'::regclass) AS rls_activee,
         (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.activity_logs'::regclass) AS force_rls
    FROM pg_policies WHERE schemaname='public' AND tablename='activity_logs';
ALTER TABLE public.:"t_org" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.:"t_al" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.:"t_pol" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.:"t_org", public.:"t_al",
              public.:"t_pol" FROM PUBLIC, anon, authenticated;
-- Verification : les comptes doivent etre identiques
SELECT (SELECT count(*) FROM public.organizations) = (SELECT count(*) FROM public.:"t_org") AS organizations_ok,
       (SELECT count(*) FROM public.activity_logs)  = (SELECT count(*) FROM public.:"t_al")  AS activity_logs_ok;
COMMIT;
-- Nettoyage (apres validation, par le proprietaire) :
--   DROP TABLE public.:"t_org", public.:"t_al", public.:"t_pol";
