-- 025_detect_duplicate_org_owner_email.sql  —  LECTURE SEULE
--
-- A executer AVANT la migration 025 (index unique partiel sur
-- lower(owner_email)). Liste les adresses qui possedent plusieurs
-- organisations non supprimees : la migration 025 refuse de creer l'index tant
-- que cette requete renvoie des lignes.
--
-- Cette requete ne modifie rien. Elle ne deduplique rien : la fusion ou la
-- suppression d'une organisation est une decision humaine (abonnement Stripe,
-- membres, donnees metier a rattacher), a prendre ligne par ligne.
--
-- Usage : psql "$DATABASE_URL" -f migrations/diagnostics/025_detect_duplicate_org_owner_email.sql

SELECT lower(o.owner_email)                                   AS owner_email_normalise,
       count(*)                                               AS nb_organisations,
       array_agg(o.id::text ORDER BY o.created_at)            AS organisation_ids,
       array_agg(o.status ORDER BY o.created_at)              AS statuts,
       array_agg(o.subscription_status ORDER BY o.created_at) AS statuts_abonnement,
       array_agg(o.stripe_customer_id ORDER BY o.created_at)  AS stripe_customer_ids,
       min(o.created_at)                                      AS plus_ancienne,
       max(o.created_at)                                      AS plus_recente
  FROM organizations o
 WHERE o.owner_email IS NOT NULL
   AND o.owner_email <> ''
   AND o.status IS DISTINCT FROM 'deleted'
 GROUP BY lower(o.owner_email)
HAVING count(*) > 1
 ORDER BY count(*) DESC, lower(o.owner_email);
