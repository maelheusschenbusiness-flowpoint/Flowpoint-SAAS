-- Retour arriere de 027 : supprime la table d'audit des remboursements de credits IA.
-- DESTRUCTIF pour l'historique des remboursements (les credits deja retires ne sont PAS rendus).
-- N'a de sens que si la table est vide ou sauvegardee. JAMAIS execute automatiquement.
-- Attention : initDataTables la recree au prochain demarrage de l'application.
SET lock_timeout = '5s';
DROP TABLE IF EXISTS public.ai_credit_refunds;
