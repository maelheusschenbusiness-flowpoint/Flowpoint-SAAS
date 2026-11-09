-- Verification de la base apres un parcours Stripe TEST. LECTURE SEULE.
-- Variables psql : :email (adresse d'essai), :stripe_sub (id sub_... releve cote Stripe via verifier-stripe.ts), :seti (id seti_... ou 'none').
-- Lancer via verifier-base.sh (refuse la base de production, impose la lecture seule).
-- Chaque ligne : nom, ok (true/false), detail. NO-GO si une seule ligne a ok = false.
BEGIN READ ONLY;

WITH o AS (
  SELECT id::text AS id, plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, trial_consumed_at
    FROM organizations WHERE lower(owner_email) = lower(:'email')
), p AS (
  SELECT token, consumed_at, expires_at FROM pending_signups WHERE lower(email) = lower(:'email')
), u AS (
  SELECT id FROM users WHERE lower(email) = lower(:'email')
), fe AS (
  -- funnel_events est creee a la demande par l'application : requete dynamique tolerante a son absence.
  SELECT CASE WHEN to_regclass('public.funnel_events') IS NULL THEN NULL
              ELSE (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.funnel_events where cle_idempotence = %L', 'checkout_completed:' || :'seti'), false, true, '')))[1]::text::int END AS n_checkout,
         to_regclass('public.funnel_events') IS NOT NULL AS table_presente
)
SELECT * FROM (
  SELECT 1 AS ord, 'une seule organisation pour l''e-mail' AS nom, (SELECT count(*) FROM o) = 1 AS ok,
         (SELECT count(*) FROM o)::text || ' organisation(s)' AS detail
  UNION ALL
  SELECT 2, 'un seul utilisateur', (SELECT count(*) FROM u) = 1, (SELECT count(*) FROM u)::text || ' utilisateur(s)'
  UNION ALL
  SELECT 3, 'subscription_status = trialing', COALESCE((SELECT bool_and(subscription_status = 'trialing') FROM o), false),
         COALESCE((SELECT string_agg(COALESCE(subscription_status,'NULL'), ',') FROM o), 'aucune organisation')
  UNION ALL
  SELECT 4, 'stripe_subscription_id = celui de Stripe', COALESCE((SELECT bool_and(stripe_subscription_id = :'stripe_sub') FROM o), false),
         COALESCE((SELECT string_agg(COALESCE(stripe_subscription_id,'NULL'), ',') FROM o), 'aucune organisation')
  UNION ALL
  SELECT 5, 'stripe_customer_id renseigne', COALESCE((SELECT bool_and(stripe_customer_id LIKE 'cus_%') FROM o), false),
         COALESCE((SELECT string_agg(COALESCE(stripe_customer_id,'NULL'), ',') FROM o), 'aucune organisation')
  UNION ALL
  SELECT 6, 'trial_ends_at ~ maintenant + 14 j (tolerance 1 j, souscription recente)',
         COALESCE((SELECT bool_and(trial_ends_at BETWEEN now() + interval '13 days' AND now() + interval '14 days 1 hour') FROM o), false),
         COALESCE((SELECT string_agg(trial_ends_at::text, ',') FROM o), 'aucune organisation')
  UNION ALL
  SELECT 7, 'trial_consumed_at renseigne', COALESCE((SELECT bool_and(trial_consumed_at IS NOT NULL) FROM o), false), 'essai marque consomme'
  UNION ALL
  SELECT 8, 'pending_signups consomme (aucune ligne ouverte)', (SELECT count(*) FROM p) >= 1 AND (SELECT count(*) FROM p WHERE consumed_at IS NULL) = 0,
         (SELECT count(*) FROM p)::text || ' ligne(s), ' || (SELECT count(*) FROM p WHERE consumed_at IS NULL)::text || ' non consommee(s)'
  UNION ALL
  SELECT 9, 'aucune autre organisation liee aux memes membres', (SELECT count(*) FROM organization_members m WHERE m.user_id IN (SELECT id FROM u) AND m.organization_id NOT IN (SELECT id FROM o)) = 0,
         (SELECT count(*) FROM organization_members m WHERE m.user_id IN (SELECT id FROM u) AND m.organization_id NOT IN (SELECT id FROM o))::text || ' appartenance(s) hors organisation principale (doit etre 0)'
  UNION ALL
  SELECT 10, 'funnel : checkout_completed de ce SetupIntent au plus une fois (idempotence)', COALESCE((SELECT n_checkout FROM fe), 0) <= 1,
         CASE WHEN :'seti' = 'none' THEN 'SetupIntent non fourni (3e argument) : non verifie'
              WHEN NOT (SELECT table_presente FROM fe) THEN 'table funnel_events absente (aucun suivi enregistre : normal sans consentement)'
              ELSE (SELECT n_checkout FROM fe)::text || ' ligne(s) (0 sans consentement analytics, 1 avec)' END
  UNION ALL
  SELECT 11, 'webhooks : aucun evenement en echec pour l''organisation',
         NOT EXISTS (SELECT 1 FROM billing_events b WHERE b.org_id IN (SELECT id FROM o) AND b.metadata->>'status' = 'failed'),
         (SELECT count(*) FROM billing_events b WHERE b.org_id IN (SELECT id FROM o) AND b.metadata->>'status' = 'failed')::text || ' evenement(s) failed'
) t ORDER BY ord;

-- Informatif (non bloquant) : evenements Stripe enregistres (une ligne par stripe_event_id, UNIQUE : un rejeu ne double rien).
SELECT b.type, b.stripe_event_id, b.metadata->>'status' AS statut, b.created_at
  FROM billing_events b WHERE b.org_id IN (SELECT id::text FROM organizations WHERE lower(owner_email) = lower(:'email'))
 ORDER BY b.created_at;

ROLLBACK;
