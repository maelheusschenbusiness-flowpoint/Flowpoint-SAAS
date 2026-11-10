-- Suite de 020 : utm_content (etape de sequence, ex. Smartlead `step1`) et
-- utm_term. Additive et idempotente : deux colonnes nullables, aucune ligne
-- existante modifiee, ni contrainte ni index. Memes regles que 020 : valeurs
-- normalisees par l'API (^[a-z0-9._-]{1,64}$), ecrites seulement apres
-- consentement `accepted`.
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_content TEXT NULL;
ALTER TABLE public.funnel_events ADD COLUMN IF NOT EXISTS utm_term    TEXT NULL;
