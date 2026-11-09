-- A-09 — DIAGNOSTIC EN LECTURE SEULE. Ne modifie rien. Jamais execute par migrate.
-- Organisations `trialing` sans souscription Stripe : a J+14 aucun prelevement ne suivra.
-- (Chemin historique : webhook setup_intent.succeeded actif, finalize-checkout jamais appele.)
-- A executer par un humain, sur la base voulue, avec un role en lecture seule.
SELECT o.id,
       o.owner_email,
       o.plan,
       o.subscription_status,
       o.stripe_customer_id,
       o.trial_ends_at,
       o.trial_consumed_at,
       o.created_at,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM (o.trial_ends_at - NOW())) / 86400))::int AS jours_restants
  FROM organizations o
 WHERE o.subscription_status = 'trialing'
   AND (o.stripe_subscription_id IS NULL OR btrim(o.stripe_subscription_id) = '')
   AND o.status IS DISTINCT FROM 'deleted'
 ORDER BY o.trial_ends_at ASC NULLS FIRST
 LIMIT 500;
