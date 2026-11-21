-- Development/test schema only. Do not apply to production without explicit approval.
CREATE TABLE IF NOT EXISTS public_audit_quota_counters (
  quota_type text NOT NULL,
  quota_key char(64) NOT NULL,
  day_utc date NOT NULL,
  used integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_audit_quota_counters_pkey
    PRIMARY KEY (quota_type, quota_key, day_utc),
  CONSTRAINT public_audit_quota_counters_quota_type_check
    CHECK (quota_type IN ('visitor', 'network', 'global')),
  CONSTRAINT public_audit_quota_counters_used_check
    CHECK (used >= 0)
);

CREATE INDEX IF NOT EXISTS public_audit_quota_counters_expires_at_idx
  ON public_audit_quota_counters (expires_at);

CREATE TABLE IF NOT EXISTS public_audit_concurrency_slots (
  slot_id smallint PRIMARY KEY,
  lease_id uuid,
  lease_expires_at timestamptz
);

INSERT INTO public_audit_concurrency_slots (slot_id)
VALUES (1), (2), (3), (4)
ON CONFLICT (slot_id) DO NOTHING;
