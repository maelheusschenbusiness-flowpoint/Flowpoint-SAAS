---
name: Stale team_members row causes 503 BILLING_DATA_UNAVAILABLE on re-registration
description: After a full account purge + re-registration, a stale legacy team_members row pointing to a deleted/absent org UUID hijacks the login session — fix location and guard pattern.
---

# Stale team_members → 503 BILLING_DATA_UNAVAILABLE

## The rule
`resolveOrCreateLegacyOrg` Step A2 AND `handleLoginVerify` S6-team-members MUST validate that the `org_id` found in `team_members` actually exists in `organizations` (status != 'deleted') before using it as `sessionOrgId`.  If the org is absent, fall through to the next step (Step B = owner_email lookup; S6 fallback = org_settings).

**Why:** A full account purge leaves `team_members` rows pointing to the old UUID (e.g. `c143bc00-…`).  When the user re-registers, a new org (`a623329c-…`) is created, but the stale `team_members` row is still there.  `resolveOrCreateLegacyOrg` Step A2 finds it first and returns the ghost UUID as `sessionOrgId`.  `loadOrgData(ghostUUID)` finds no row in `organizations` and no row in `org_settings` → returns null → `/api/me` emits 503 BILLING_DATA_UNAVAILABLE on every request.

**How to apply:** The fix is already in place in `src/routes/auth.ts`:
- `resolveOrCreateLegacyOrg` Step A2: after reading `guestMember`, runs `SELECT 1 FROM organizations WHERE id::text = $1 AND status != 'deleted' LIMIT 1`.  If 0 rows → logs "stale row after purge" + falls through.
- `handleLoginVerify` S6-team-members: same guard, clears `s6GuestOrgId = null` on miss so the org_settings fallback runs.

## Diagnostic endpoint
`GET /api/admin/account-state?email=xxx` (x-admin-key required) returns:
- `users`, `team_members`, `organizations`, `org_settings`, `organization_members`, `pending_signups`
- `session_org_checks[]` with `resolves: bool`, `org_id_is_uuid: bool` per active session

## Observable symptoms
- `/api/me` → HTTP 503 `{ ok: false, error: "BILLING_DATA_UNAVAILABLE" }` immediately after login
- `session_org_checks[*].resolves === false` + `org_id !== organizations.id` for all active sessions
- `team_members.org_id` ≠ `organizations.id` for the affected email

## Data confirmed (2026-09-08 production incident)
- Email: maelheusschen.business@gmail.com
- Ghost UUID: c143bc00-27ec-4b01-8956-a63e5ca95f09 (in team_members, NOT in organizations)
- Real UUID: a623329c-12c6-4228-bb46-0faf6a7242ed (new org after re-registration)
- All 3 active sessions had org_id = ghost UUID → resolves: false

## Recovery for affected user
After deploying the fix: user must log out and log back in.  The new login session will use the correct `a623329c` UUID (found via Step B owner_email lookup).  Existing sessions with the ghost UUID remain broken until they expire or the user invalidates them.
