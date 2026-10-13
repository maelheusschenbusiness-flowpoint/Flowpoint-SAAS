-- 020_organizations_subscription_event_watermark.sql
--
-- Stripe ne garantit pas l'ordre de livraison des evenements. Un
-- `customer.subscription.updated` ancien, relivre apres un plus recent,
-- ecrasait l'etat de facturation courant : un client Pro paye repassait en
-- Standard/trialing (regression reproduite en certification P0).
--
-- Cette colonne sert de filigrane : le handler applique un evenement
-- d'abonnement seulement s'il est au moins aussi recent que le dernier
-- applique (compare-and-set atomique, voir claimSubscriptionEventOrder).
--
-- Aucune donnee n'est modifiee ni supprimee. La colonne est NULL pour les
-- organisations existantes, ce qui laisse passer le premier evenement suivant.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS last_subscription_event_at TIMESTAMPTZ;
