-- Retour arriere de 026 : supprime les 4 policies tenant_* de activity_logs.
--
-- GARDE-FOU : a n'executer que si l'etat AVANT 026 etait « RLS activee et AUCUNE
-- policy » (releve par le diagnostic de pre-verification). Si les policies existaient
-- deja avant (demarrage normal), 026 etait un no-op : NE PAS executer ce script, il
-- retirerait des policies legitimes (refus total pour les roles soumis a RLS).
--
-- Usage : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_pre_state_no_policies=yes \
--              [-v rls=on|off] [-v force=on|off] -f 026_..._down.sql
--   rls / force : etat RLS releve AVANT 026 (defaut : on / on, etat de init-data-tables.ts).
-- Ne touche a aucune donnee.
\if :{?confirm_pre_state_no_policies}
\else
  \echo 'ERREUR : passer -v confirm_pre_state_no_policies=yes (voir en-tete)'
  -- \quit renverrait 0 : on echoue explicitement (ON_ERROR_STOP => code 3)
  DO $$ BEGIN RAISE EXCEPTION '026 down refuse : confirmation absente'; END $$;
\endif
\if :{?rls}
\else
  \set rls on
\endif
\if :{?force}
\else
  \set force on
\endif
\if :{?confirm_pre_state_no_policies}
SET lock_timeout = '5s';
DROP POLICY IF EXISTS tenant_select ON public.activity_logs;
DROP POLICY IF EXISTS tenant_insert ON public.activity_logs;
DROP POLICY IF EXISTS tenant_update ON public.activity_logs;
DROP POLICY IF EXISTS tenant_delete ON public.activity_logs;
-- Remise de l'etat RLS initial (026 ne le modifie pas : ces lignes sont des no-op
-- sauf si quelqu'un l'a change entre-temps).
\if :rls
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
\else
ALTER TABLE public.activity_logs DISABLE ROW LEVEL SECURITY;
\endif
\if :force
ALTER TABLE public.activity_logs FORCE ROW LEVEL SECURITY;
\else
ALTER TABLE public.activity_logs NO FORCE ROW LEVEL SECURITY;
\endif
\endif
