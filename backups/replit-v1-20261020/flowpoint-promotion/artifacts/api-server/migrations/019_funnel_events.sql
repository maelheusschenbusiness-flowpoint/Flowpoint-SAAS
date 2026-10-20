-- Anonymous, consent-based funnel events. No email, IP, or Stripe identifiers.
-- RLS with no client policies intentionally denies direct PostgREST access;
-- the API server's database role remains the sole writer/reader.
CREATE TABLE IF NOT EXISTS public.funnel_events (
  id              BIGSERIAL PRIMARY KEY,
  etape           TEXT NOT NULL CHECK (etape IN (
    'landing_vue',
    'tarifs_vus',
    'cta_clique',
    'signup_started',
    'signup_form_completed',
    'checkout_started',
    'checkout_completed',
    'trial_activated',
    'trial_expired',
    'subscription_activated'
  )),
  visiteur_id     TEXT,
  org_ref         TEXT,
  plan            TEXT,
  source          TEXT,
  cle_idempotence TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_events_etape_date_idx
  ON public.funnel_events (etape, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS funnel_events_idem_uniq
  ON public.funnel_events (cle_idempotence)
  WHERE cle_idempotence IS NOT NULL;

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.funnel_events FROM PUBLIC;
