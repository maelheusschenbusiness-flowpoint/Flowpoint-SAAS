---
name: orgId UUID fix — S3-legacy + S6-fallback + guards
description: Legacy users (org_settings only, no organizations/org_members) received email as sessionOrgId → 22P02 on planGate and persistOrgData. Three-layer fix applied.
---

# orgId UUID fix

## The rule
`sessionOrgId` must always be a UUID string that matches `organizations.id`. Email strings must never be stored in `user_sessions.org_id`.

**Why:** `organizations.id` is a UUID column in production Supabase. Any query `WHERE id = email` throws 22P02 → planGate returns null → 503 on every protected route.

## Root cause
Two auth paths assigned `sessionOrgId = email`:
- **S3-legacy** (auth.ts): user absent from `users` table, but found in `org_settings`
- **S6-fallback** (auth.ts): user in `users`, no `organization_members` row, found in `org_settings`

Both happen because `organization_members.organization_id` stores the email for legacy orgs (from old backfill), but `organizations.id` is UUID — so the S2b JOIN produces 0 rows.

## Fix — three layers

### Layer 1: auth.ts `resolveOrCreateLegacyOrg` helper
Called from S3-legacy and S6-fallback instead of `sessionOrgId = email`.
- Step A: ensure `users` row exists (S3-legacy creates it), get UUID
- Step B: look up `organizations WHERE owner_email = email` → use existing UUID org
- Step C: if none found, INSERT new UUID org from `org_settings` data + INSERT `organization_members` row
- Returns `{ orgId: UUID, userUuid: UUID }` — never an email

### Layer 2: planGate.ts UUID guard
`UUID_RE` check at start of `resolvePlanFromDB`. Non-UUID orgId → skip `organizations` query, go directly to `org_settings`. Protects surviving pre-fix sessions.

### Layer 3: org-data.ts UUID guards
- `loadOrgData`: skip `organizations` query for non-UUID orgId, fall through to org_settings
- `persistOrgData`: `if (orgIdIsUuid)` wraps the organizations INSERT/UPDATE — non-UUID orgId only gets the org_settings mirror write

## How to apply
Any new query that does `WHERE organizations.id = $1` must either:
1. Verify `orgId` is UUID before executing (`UUID_RE.test(orgId)`), OR
2. Be called only from paths where orgId is guaranteed to be a UUID (post S10 session creation)

## QA tests
- `.local/qa_magic_link_regression.cjs` — 6 assertions (S2b fix, happy path)
- `.local/qa_orgid_uuid_regression.cjs` — 12 assertions (S6-fallback UUID, plan copy, /api/me 200, legacy session guard)
