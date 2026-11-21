-- Review-only, idempotent DDL for the two public-audit tables.
-- Apply only through an approved, scoped migration process; never use a
-- global drizzle-kit push for this change.
BEGIN;

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

CREATE TABLE IF NOT EXISTS public_audit_concurrency_slots (
  slot_id smallint NOT NULL,
  lease_id uuid,
  lease_expires_at timestamptz,
  CONSTRAINT public_audit_concurrency_slots_pkey PRIMARY KEY (slot_id)
);

-- IF NOT EXISTS alone can hide an incompatible object with the same name.
-- Fail closed unless the pre-existing objects match this reviewed shape.
DO $release_schema$
BEGIN
  IF (
    SELECT count(*)
      FROM pg_attribute
     WHERE attrelid = 'public_audit_quota_counters'::regclass
       AND attnum > 0
       AND NOT attisdropped
  ) <> 6 OR EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('quota_type', 'text', true, NULL::text),
          ('quota_key', 'bpchar', true, NULL::text),
          ('day_utc', 'date', true, NULL::text),
          ('used', 'int4', true, '0'::text),
          ('expires_at', 'timestamptz', true, NULL::text),
          ('updated_at', 'timestamptz', true, 'now()'::text)
      ) AS expected(column_name, type_name, is_not_null, default_expression)
      LEFT JOIN pg_attribute AS attribute
        ON attribute.attrelid = 'public_audit_quota_counters'::regclass
       AND attribute.attname = expected.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      LEFT JOIN pg_type AS type ON type.oid = attribute.atttypid
      LEFT JOIN pg_attrdef AS column_default
        ON column_default.adrelid = attribute.attrelid
       AND column_default.adnum = attribute.attnum
     WHERE attribute.attname IS NULL
        OR type.typname IS DISTINCT FROM expected.type_name
        OR attribute.attnotnull IS DISTINCT FROM expected.is_not_null
        OR COALESCE(pg_get_expr(column_default.adbin, column_default.adrelid), '')
           IS DISTINCT FROM COALESCE(expected.default_expression, '')
  ) THEN
    RAISE EXCEPTION 'public_audit_quota_counters has an incompatible column set';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_constraint
     WHERE conrelid = 'public_audit_quota_counters'::regclass
  ) <> 3 OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public_audit_quota_counters'::regclass
       AND conname = 'public_audit_quota_counters_pkey'
       AND contype = 'p'
       AND convalidated
       AND regexp_replace(pg_get_constraintdef(oid, true), '\s+', '', 'g')
           = 'PRIMARYKEY(quota_type,quota_key,day_utc)'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public_audit_quota_counters'::regclass
       AND conname = 'public_audit_quota_counters_quota_type_check'
       AND contype = 'c'
       AND convalidated
       AND regexp_replace(pg_get_constraintdef(oid, true), '\s+', '', 'g')
           = 'CHECK(quota_type=ANY(ARRAY[''visitor''::text,''network''::text,''global''::text]))'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public_audit_quota_counters'::regclass
       AND conname = 'public_audit_quota_counters_used_check'
       AND contype = 'c'
       AND convalidated
       AND regexp_replace(pg_get_constraintdef(oid, true), '\s+', '', 'g')
           = 'CHECK(used>=0)'
  ) THEN
    RAISE EXCEPTION 'public_audit_quota_counters has incompatible constraints';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_attribute
     WHERE attrelid = 'public_audit_concurrency_slots'::regclass
       AND attnum > 0
       AND NOT attisdropped
  ) <> 3 OR EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('slot_id', 'int2', true),
          ('lease_id', 'uuid', false),
          ('lease_expires_at', 'timestamptz', false)
      ) AS expected(column_name, type_name, is_not_null)
      LEFT JOIN pg_attribute AS attribute
        ON attribute.attrelid = 'public_audit_concurrency_slots'::regclass
       AND attribute.attname = expected.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      LEFT JOIN pg_type AS type ON type.oid = attribute.atttypid
     WHERE attribute.attname IS NULL
        OR type.typname IS DISTINCT FROM expected.type_name
        OR attribute.attnotnull IS DISTINCT FROM expected.is_not_null
  ) OR (
    SELECT count(*)
      FROM pg_constraint
     WHERE conrelid = 'public_audit_concurrency_slots'::regclass
  ) <> 1 OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public_audit_concurrency_slots'::regclass
       AND conname = 'public_audit_concurrency_slots_pkey'
       AND contype = 'p'
       AND convalidated
       AND regexp_replace(pg_get_constraintdef(oid, true), '\s+', '', 'g')
           = 'PRIMARYKEY(slot_id)'
  ) THEN
    RAISE EXCEPTION 'public_audit_concurrency_slots has an incompatible shape';
  END IF;
END;
$release_schema$;

CREATE INDEX IF NOT EXISTS public_audit_quota_counters_expires_at_idx
  ON public_audit_quota_counters (expires_at);

DO $release_index$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS index_relation
      JOIN pg_index AS index_data
        ON index_data.indexrelid = index_relation.oid
      JOIN pg_am AS access_method
        ON access_method.oid = index_relation.relam
     WHERE index_relation.relnamespace = current_schema()::regnamespace
       AND index_relation.relname = 'public_audit_quota_counters_expires_at_idx'
       AND index_data.indrelid = 'public_audit_quota_counters'::regclass
       AND index_data.indisvalid
       AND index_data.indisready
       AND NOT index_data.indisunique
       AND index_data.indpred IS NULL
       AND index_data.indexprs IS NULL
       AND index_data.indnatts = 1
       AND index_data.indnkeyatts = 1
       AND access_method.amname = 'btree'
       AND pg_get_indexdef(index_relation.oid, 1, true) = 'expires_at'
  ) THEN
    RAISE EXCEPTION 'public_audit_quota_counters_expires_at_idx is incompatible';
  END IF;
END;
$release_index$;

COMMIT;

-- No concurrency rows are seeded here. At reservation time the application
-- inserts slots 1..configured maximum with ON CONFLICT DO NOTHING.
