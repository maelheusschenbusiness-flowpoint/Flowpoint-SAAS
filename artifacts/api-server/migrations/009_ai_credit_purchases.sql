-- AI Credit one-time purchases table
CREATE TABLE IF NOT EXISTS ai_credit_purchases (
  id                   TEXT        PRIMARY KEY,
  org_id               TEXT        NOT NULL,
  pack                 TEXT        NOT NULL,
  credits              INTEGER     NOT NULL,
  amount_eur_cents     INTEGER     NOT NULL DEFAULT 0,
  stripe_session_id    TEXT,
  stripe_payment_intent TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_purchases_org
  ON ai_credit_purchases(org_id, created_at DESC);
