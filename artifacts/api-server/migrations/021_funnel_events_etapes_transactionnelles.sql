-- Etapes du tunnel ajoutees apres la migration 019 : le refus de carte declare par le navigateur
-- (`checkout_payment_failed`) et le comptage transactionnel des paiements (`payment_succeeded`, `payment_failed`).
-- Sans cette migration la contrainte `funnel_events_etape_check` refuse ces etapes et l'application, qui avale
-- l'erreur par conception (une mesure ne doit jamais casser un parcours), les perd sans bruit.
-- Elargissement seul : aucune ligne existante modifiee, toutes respectent deja la contrainte. Idempotente.
-- A conserver alignee sur `ETAPES_TUNNEL` (src/services/funnel-events.ts) : un test le verifie.
ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_etape_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_etape_check CHECK (etape IN (
  'landing_vue', 'tarifs_vus', 'cta_clique', 'signup_started', 'signup_form_engaged',
  'signup_form_completed', 'checkout_started', 'checkout_completed', 'checkout_payment_failed',
  'trial_activated', 'trial_expired', 'subscription_activated', 'payment_succeeded', 'payment_failed'
));
