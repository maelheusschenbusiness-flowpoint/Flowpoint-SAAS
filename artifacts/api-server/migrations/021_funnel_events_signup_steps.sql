-- Mesure d'inscription (14/11/2026) : `signup_submitted` et `signup_failed`.
-- Applique aussi au demarrage par `assurerEtapesTunnel` (union des valeurs deja
-- admises, rien retire). Ici, la liste complete constatee en production le 14/11.
ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_etape_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_etape_check CHECK (etape IN (
  'landing_vue', 'tarifs_vus', 'cta_clique', 'signup_started', 'signup_form_engaged',
  'signup_submitted', 'signup_failed', 'signup_form_completed', 'checkout_started',
  'checkout_completed', 'checkout_payment_failed', 'trial_activated', 'trial_expired',
  'subscription_activated', 'payment_succeeded', 'payment_failed'
));
