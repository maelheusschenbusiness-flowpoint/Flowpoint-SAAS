-- 023_organizations_cancel_at_period_end.sql
--
-- Stripe porte l'annulation programmee sur l'abonnement
-- (cancel_at_period_end + cancel_at). FlowPoint ne la persistait pas :
-- reproduit avec un evenement Stripe reel — Stripe renvoyait
-- cancel_at_period_end=true et cancel_at=2026-10-27, le webhook acceptait
-- l'evenement (HTTP 200), et aucune trace n'existait en base ni dans /me.
--
-- Consequence : impossible d'afficher « votre abonnement se termine le … »,
-- impossible de distinguer « actif qui se renouvelle » de « actif qui
-- s'arrete », alors que billing.ts sait deja lever cette annulation
-- (reactivation) en relisant l'etat chez Stripe a la demande.
--
-- Ajout additif et idempotent. Aucune donnee client modifiee : la valeur par
-- defaut false correspond a « aucune annulation programmee », ce qui est le
-- cas de la quasi-totalite des abonnements ; le prochain evenement
-- d'abonnement renseigne la valeur reelle.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;
