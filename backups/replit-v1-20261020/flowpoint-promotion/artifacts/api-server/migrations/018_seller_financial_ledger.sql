-- Migration 018: append-only seller financial event ledger.
-- Every economic fact has a durable source_key, so Stripe retries are harmless.
CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  seller_code TEXT UNIQUE NOT NULL,
  name TEXT, email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS seller_commissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  org_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  stripe_customer_id TEXT, stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT, stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT, plan TEXT NOT NULL,
  eligible_amount_cents INTEGER NOT NULL DEFAULT 0,
  commission_rate_bps INTEGER NOT NULL DEFAULT 3500,
  commission_amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'eur',
  status TEXT NOT NULL DEFAULT 'pending',
  attribution_method TEXT NOT NULL DEFAULT 'ref_link',
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  earned_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  paid_by TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_seller_commissions_org UNIQUE (org_id)
);
CREATE TABLE IF NOT EXISTS seller_financial_ledger (
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  seller_id                   TEXT NOT NULL REFERENCES sellers(id),
  org_id                      TEXT,
  event_type                  TEXT NOT NULL,
  source_key                  TEXT NOT NULL UNIQUE,
  amount_cents                INTEGER NOT NULL DEFAULT 0,
  currency                    TEXT NOT NULL DEFAULT 'eur',
  commission_id               TEXT,
  stripe_invoice_id           TEXT,
  stripe_payment_intent_id    TEXT,
  stripe_charge_id            TEXT,
  stripe_refund_id            TEXT,
  stripe_subscription_id      TEXT,
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_financial_ledger_event_type_ck CHECK (
    event_type IN (
      'payment_received', 'refund', 'commission_generated', 'commission_paid',
      'commission_reversed', 'commission_clawback'
    )
  )
);
CREATE INDEX IF NOT EXISTS seller_financial_ledger_seller_idx
  ON seller_financial_ledger(seller_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS seller_financial_ledger_org_idx
  ON seller_financial_ledger(org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS seller_financial_ledger_stripe_idx
  ON seller_financial_ledger(stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id);
ALTER TABLE seller_financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_financial_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seller_financial_ledger_app_user_all ON seller_financial_ledger;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS seller_attribution_method TEXT NOT NULL DEFAULT 'ref_link';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seller_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_consumed_at TIMESTAMPTZ;
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS seller_id TEXT;
CREATE INDEX IF NOT EXISTS organizations_seller_idx ON organizations(seller_id);
UPDATE organizations o SET
  subscription_status = COALESCE(o.subscription_status, os.subscription_status),
  trial_ends_at = COALESCE(o.trial_ends_at, os.trial_ends_at),
  trial_started_at = COALESCE(o.trial_started_at, os.trial_started_at),
  trial_consumed_at = COALESCE(o.trial_consumed_at, os.trial_consumed_at)
 FROM org_settings os WHERE os.org_id = o.id::text;
UPDATE organizations o
   SET seller_attribution_method = 'manual'
  FROM seller_commissions sc
 WHERE sc.org_id = o.id::text AND sc.attribution_method = 'manual';

-- Preserve pre-ledger acquisition commissions in the canonical history.
INSERT INTO seller_financial_ledger
  (seller_id, org_id, event_type, source_key, amount_cents, currency, commission_id,
   stripe_invoice_id, stripe_subscription_id, metadata, occurred_at)
SELECT seller_id, org_id, 'commission_generated', 'commission-generated:existing:' || id,
       commission_amount_cents, currency, id, stripe_invoice_id, stripe_subscription_id,
       jsonb_build_object('backfilled', true), COALESCE(earned_at, created_at)
  FROM seller_commissions
 ON CONFLICT (source_key) DO NOTHING;
INSERT INTO seller_financial_ledger
  (seller_id, org_id, event_type, source_key, amount_cents, currency, commission_id, metadata, occurred_at)
SELECT seller_id, org_id, 'commission_paid', 'commission-paid:existing:' || id,
       commission_amount_cents, currency, id,
       jsonb_build_object('backfilled', true, 'paid_by', paid_by, 'notes', notes),
       COALESCE(paid_at, created_at)
  FROM seller_commissions WHERE status = 'paid'
 ON CONFLICT (source_key) DO NOTHING;