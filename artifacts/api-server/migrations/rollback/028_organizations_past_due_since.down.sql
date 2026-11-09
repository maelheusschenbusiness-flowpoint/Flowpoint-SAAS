-- Retour arriere de 028 : supprime la colonne de debut d'episode past_due.
-- Perd la date de debut de grace ; le code de #401 la relit avec un repli si elle est absente.
-- JAMAIS execute automatiquement. initDataTables la recree au prochain demarrage de l'application.
SET lock_timeout = '5s';
ALTER TABLE public.organizations DROP COLUMN IF EXISTS past_due_since;
