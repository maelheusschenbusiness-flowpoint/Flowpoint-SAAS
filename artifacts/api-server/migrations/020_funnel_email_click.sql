-- Attribution Smartlead (27/10/2026) : le clic d'un email de prospection,
-- compte cote serveur par `GET /go` (etape `email_clic`, source `smartlead`).
--
-- Idempotent et sans perte : relancer est sans effet, aucune ligne existante
-- n'est modifiee, et chaque ligne existante respecte la nouvelle contrainte.
-- Aucune donnee personnelle : ni IP, ni user-agent, ni fp_lid en clair (le
-- `visiteur_id` d'un clic est `lid-` + un condensat tronque). Seuls un drapeau
-- grossier `bot_suspect`, la campagne et la variante (valeurs d'une liste fermee).
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS campagne    TEXT;
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS variante    TEXT;
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS bot_suspect BOOLEAN;

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_etape_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_etape_check CHECK (etape IN (
  'landing_vue', 'tarifs_vus', 'cta_clique', 'signup_started', 'signup_form_engaged',
  'signup_form_completed', 'checkout_started', 'checkout_completed', 'trial_activated',
  'trial_expired', 'subscription_activated', 'email_clic'
));
