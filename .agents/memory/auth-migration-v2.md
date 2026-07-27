---
name: Auth migration v2 — users/org_members/organizations
description: 4-phase migration plan, schema decisions, backward-compat patterns, validation scripts
---

## Migration completed 2026-07-27

### Schema
- `users` — UUID PK, email UNIQUE, status CHECK('active','suspended','pending'), email_verified BOOL
- `organization_members` — UNIQUE(organization_id, user_id), role CHECK('owner','admin','member','viewer'), status CHECK('active','inactive')
- `organizations` — 14 new cols incl subscription_status, stripe_customer_id, owner_email, plan, addons, trial_ends_at
- `user_sessions.user_id_v2` — nullable UUID FK → users.id (backward compat with existing TEXT user_id)

### login-verify new flow (6 checks before session creation)
1. Token valid + not used
2. User exists in `users` (fallback: org_settings if not yet migrated)
3. email_verified = TRUE
4. user.status = 'active'
5. Has active org membership in organization_members
6. organizations.subscription_status NOT IN ('pending_billing','canceled','incomplete')

**Why:** Was reading only org_settings; no user-level checks; session could be created for suspended/unverified users.

**How to apply:** All new auth providers (Google, GitHub, etc.) must also land on the same check sequence.

### Backward compat
- Sessions still use `userId: orgId` (TEXT) for existing middleware compatibility
- Legacy accounts not yet in `users` fall through to org_settings check (check 2 fallback)
- org_settings marked `_readonly_since` on all 106 rows — do NOT write new data to it

### Phase 4 TODO (not yet done)
- Stop writing to org_settings in: billing routes, Stripe webhooks, ensureStripeCustomer service
- Drop org_settings table after 30-day readonly period (≈ 2026-08-27)
- Migrate createSession() to populate user_id_v2 automatically for new sessions

### Validation scripts
- `/tmp/validate-phase1.cjs` — Phase 1 DDL checks
- `/tmp/validate-phase2.cjs` — Phase 2 backfill checks  
- `/tmp/validate-phase3.cjs` — Phase 3 auth flow checks (10/10)
- `/tmp/validate-phase4.cjs` — Phase 4 architectural invariants (19/19)

### Final inventory (2026-07-27)
- users=58 (active=34 pending=24)
- organization_members=76 (64 owners)
- organizations active=64 deleted=19
- Sessions=42, all linked to user_id_v2
