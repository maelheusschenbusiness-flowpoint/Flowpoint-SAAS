-- 021_organizations_current_period_end.sql
--
-- Politique produit : un abonnement expire, annule ou suspendu bloque les
-- fonctionnalites payantes SAUF si la periode deja payee reste valide. Cette
-- date n'etait lue que depuis Stripe au moment d'une reactivation et n'etait
-- jamais persistee — le controle d'acces serveur ne pouvait donc pas honorer
-- la periode payee.
--
-- Le webhook Stripe alimente desormais cette colonne depuis
-- customer.subscription.created / updated. Aucune donnee client n'est
-- modifiee : la colonne est NULL pour les organisations existantes, ce qui
-- signifie simplement « aucune periode payee connue » jusqu'au prochain
-- evenement d'abonnement.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- Colonnes lues par loadOrgData() mais jusqu'ici creees uniquement par les
-- migrations SQL historiques. Sur une base posee par initDataTables seul (le
-- seul chemin applique en production), le SELECT de loadOrgData echouait et
-- tout etat de facturation devenait illisible. Ajout additif, idempotent.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS addons            JSONB;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan      TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan_date TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_first_name  TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_last_name   TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website           TEXT;
