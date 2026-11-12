-- Attribution fine des campagnes (UTM) sur le tunnel anonyme. Additive et
-- idempotente : trois colonnes nullables, aucune ligne existante modifiee,
-- aucune contrainte ni index ajoutes (pas de verrou long). Les valeurs sont des
-- libelles de campagne normalises par l'API (^[a-z0-9._-]{1,64}$), jamais une
-- donnee personnelle ; elles ne sont ecrites qu'apres consentement `accepted`.
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_source   TEXT NULL;
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_medium   TEXT NULL;
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_campaign TEXT NULL;
