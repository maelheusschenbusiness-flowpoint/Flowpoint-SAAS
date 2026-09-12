---
name: finalize-checkout users.id null
description: PG 23502 in finalize-checkout FC-4a because users.id has no DEFAULT and the INSERT omitted it
---

## Rule
`users.id` is UUID NOT NULL with **no DEFAULT**. Every INSERT must supply `id` explicitly.

## Root cause (confirmed 2026-08-16)
`finalize-checkout` INSERT INTO users listed only `(email, first_name, last_name, auth_provider, email_verified, status)` — no `id` column. PostgreSQL 23502: null value in column "id" violates not-null constraint.

## Fix applied (commit 816c1814b4, deployed 15:21 UTC)
```typescript
const _fcNewUserId = _fcRandUUID();   // randomUUID() already imported in scope at L1577
INSERT INTO users (id, email, first_name, last_name, auth_provider, email_verified, status)
VALUES ($4,$1,$2,$3,'magic_link',TRUE,'active')
ON CONFLICT (email) DO UPDATE
  SET status='active', email_verified=TRUE,
      first_name=COALESCE(EXCLUDED.first_name,users.first_name), updated_at=NOW()
RETURNING id
params: [email, firstName, lastName, _fcNewUserId]
```

**Why:** `id` is NOT in the SET clause → ON CONFLICT returns the existing id unchanged. Idempotency verified: two runs with different UUIDs both return the first UUID, row count stays 1.

## How to apply
Any future INSERT INTO users anywhere must include `id = randomUUID()` (or `gen_random_uuid()` in SQL). Never rely on a column DEFAULT that doesn't exist.
