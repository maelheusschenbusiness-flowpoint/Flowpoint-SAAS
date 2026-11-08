-- Suivi des remboursements de credits IA (journal d'audit `refund_adjustment`).
-- Idempotent. Reference de definition : le schema reel est cree par
-- services/init-data-tables.ts (voir migrations/README.md). Non applique ici.
CREATE TABLE IF NOT EXISTS ai_credit_refunds (
  refund_id                  TEXT PRIMARY KEY,           -- re_... (idempotence)
  purchase_id                TEXT NOT NULL,              -- ai_credit_purchases.id (acp_*)
  org_id                     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_intent             TEXT,
  charge_id                  TEXT,
  refund_amount_cents        BIGINT NOT NULL,
  status                     TEXT NOT NULL,              -- applied | reversed | ignored
  refund_status              TEXT,                       -- dernier statut Stripe vu
  kind                       TEXT NOT NULL DEFAULT 'refund_adjustment',
  credits_target             INTEGER NOT NULL DEFAULT 0,
  credits_removed            INTEGER NOT NULL DEFAULT 0,
  credits_shortfall          INTEGER NOT NULL DEFAULT 0,
  cumulative_refunded_cents  BIGINT NOT NULL DEFAULT 0,
  cumulative_credits_removed INTEGER NOT NULL DEFAULT 0,
  livemode                   BOOLEAN,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_refunds_purchase ON ai_credit_refunds(purchase_id);
CREATE INDEX IF NOT EXISTS idx_ai_credit_refunds_org ON ai_credit_refunds(org_id, created_at DESC);
