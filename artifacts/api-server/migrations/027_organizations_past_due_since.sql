-- 027_organizations_past_due_since.sql
--
-- Regle commerciale : un compte past_due garde l'acces complet pendant une
-- grace (PAST_DUE_GRACE_DAYS, defaut 3 jours) puis passe en lecture seule.
-- La grace se mesure depuis le debut de l'episode past_due ; aucune colonne ne
-- le portait (la grace n'etait bornee que par current_period_end, que Stripe
-- avance deja au renouvellement : jusqu'a un mois d'acces non paye).
--
-- Posee UNE FOIS par invoice.payment_failed (COALESCE : une relance ne repousse
-- pas la grace), remise a NULL au retour active/trialing.
--
-- Additif et idempotent. NON applique ici : initDataTables ajoute la meme
-- colonne au demarrage de l'API. Le backfill ne touche que les organisations
-- deja past_due sans horodatage et leur donne NOW() : leur grace de N jours
-- demarre au deploiement, aucun client n'est bascule brutalement.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

UPDATE organizations
   SET past_due_since = NOW()
 WHERE subscription_status = 'past_due'
   AND past_due_since IS NULL;
