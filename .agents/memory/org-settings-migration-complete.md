---
name: org_settings → organizations migration (7 jalons)
description: Complete migration from org_settings (legacy) to organizations as sole billing source of truth. All 7 jalons done and validated.
---

## Rule
`organizations` is the sole billing source of truth. `org_settings` is profile-only (firstName, lastName, timezone, location, etc.) and will eventually be dropped.

**Why:** Multi-tenant billing isolation — `org_settings` used a single-table pattern with org_id TEXT; `organizations` + `organization_members` + `users` is the new normalized schema. Stripe is the activation gate.

## What was done per jalon

| Jalon | File(s) | Change |
|-------|---------|--------|
| J1 | `services/org-data.ts`, `init-phase1-users.ts` | loadOrgData / persistOrgData service; self-healing sync |
| J2 | `services/sessions.ts`, `middlewares/orgContext.ts` | user_sessions.user_id_v2 UUID backfill |
| J3 | `routes/team.ts` | organization_members backfill + dual-writes on invite/role/delete |
| J4 | `routes/me.ts`, `services/ai-engine.ts` | GET /api/me parallel fetch; ai-engine loadOrgSettings → loadOrgData |
| J5 | `services/monitor-cron.ts`, `init-phase1-users.ts` | trial-cron SELECT/UPDATE on organizations; trial_ending_notified_at column added |
| J6 | `routes/addons.ts`, `routes/team.ts` | addons plan check → loadOrgData; getOrgSeatLimit no org_settings JOIN; plan casing normalized to lowercase |
| J7 | `routes/billing.ts`, `routes/stripe-webhook.ts` | Removed addons mirror upsert; resource_missing + customer.deleted → UPDATE organizations; new-signup org_settings is profile-only |

## How to apply
- Any new billing read → use `loadOrgData(orgId)` (returns OrgBillingData: plan, subscriptionStatus, stripe*, trial*, email, firstName, orgName)
- Any new billing write → use `persistOrgData(orgId, fields)` or direct `UPDATE organizations WHERE id = $1`
- Profile reads (timezone, lastName, address) → `loadOrgSettings(orgId)` still acceptable
- `persistSubscriptionMeta` in stripe-webhook.ts already only writes to `organizations` via `persistOrgData`
- planGate + rateLimiter: primary=organizations, fallback=org_settings (dead code — all orgs migrated)
- `monitor-cron.ts` trial-cron: reads `organizations.owner_email` / `owner_first_name`, writes `trial_ending_notified_at` on `organizations`

## Key column names (organizations vs org_settings)

| Concept | organizations column | org_settings column |
|---------|---------------------|---------------------|
| Org key | `id` | `org_id` |
| Email | `owner_email` | `email` |
| First name | `owner_first_name` | `first_name` |
| Last name | `owner_last_name` | `last_name` |
| Org name | `name` | `org_name` |
| Plan | `plan` (lowercase) | `plan` |
| Sub status | `subscription_status` | `subscription_status` |
| Trial notified | `trial_ending_notified_at` | `trial_ending_notified_at` |
