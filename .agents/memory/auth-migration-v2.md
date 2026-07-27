---
name: Auth migration v2 — users/org_members/organizations + Stripe-gated signup
description: 4-phase migration schema, 6-check login-verify, Stripe-only activation flow
---

## Migration completed 2026-07-27 — Stripe-gated flow added 2026-07-27

### Schema
- `users` — UUID PK, email UNIQUE, status CHECK('active','suspended','pending'), email_verified BOOL
- `organization_members` — UNIQUE(organization_id, user_id), role CHECK('owner','admin','member','viewer'), status
- `organizations` — 14 new cols incl subscription_status, stripe_customer_id, owner_email, plan, addons, trial_ends_at
- `user_sessions.user_id_v2` — nullable UUID FK → users.id

### New signup flow (2026-07-27) — Stripe is the sole activation gate
1. `/auth/pre-register` → creates `pending_signups` row + `users` row (status='pending', email_verified=false)
   - NO magic link, NO session
2. `public-billing.ts` → Stripe checkout session with `pre_register_token` + `orgId` + `selected_plan` in metadata
3. Stripe webhook `checkout.session.completed` → activates account:
   - Activates `users` row (status='active', email_verified=true) via UPSERT
   - Creates `organizations` row (new architecture)
   - Creates `organization_members` row (owner)
   - Creates `org_settings` row (legacy compat, marked _readonly_since)
   - Generates magic link token (24h TTL) in `magic_link_tokens`
   - Sends `sendActivationMagicLink` email (new mailer type)
   - Marks `pending_signups` consumed
4. User clicks magic link → `login-verify` → 6 checks → session created

**Why:** Previously, /auth/checkout-complete created an immediate auto-session without any user validation.
Now Stripe is the only activation path and magic link is the only login path.

**How to apply:** Any new auth provider (Google, GitHub) for new signups must also go through Stripe first.

### login-verify flow (6 checks before session creation)
1. Token valid + not used
2. User exists in `users` (fallback: org_settings if not yet migrated)
3. email_verified = TRUE
4. user.status = 'active' (blocks 'pending' and 'suspended')
5. Has active org membership in organization_members
6. organizations.subscription_status NOT IN ('pending_billing','canceled','incomplete')

### /auth/login-request guards (in order)
1. Email format validation
2. Allowlist check (if configured)
3. New architecture: `users.status` → 'pending'=402, 'suspended'=403, other non-active=403
4. Legacy fallback: org_settings.subscription_status === 'pending_billing' → 402
5. No account at all → 404

### /auth/checkout-complete (new behavior)
- Verifies Stripe session is paid (Stripe API call)
- If not confirmed: returns 202 { pending: true } (frontend should poll)
- If confirmed: returns { ok: true, emailSent: true } — NO session created
- Webhook sends the magic link email independently

### Mailer — sendActivationMagicLink (new email type)
- Tags: 'activation_magic_link'
- Supports isTrial=true (purple accent) and isTrial=false (blue accent)
- Magic link URL has 24h TTL
- Fire-and-forget from webhook

### Backward compat
- Legacy accounts (not in users table) still work via org_settings fallback in login-request + login-verify
- Sessions still use userId=orgId (TEXT) for existing middleware compatibility
- org_settings marked _readonly_since — do NOT write new data to it (except webhook compat layer)

### Phase 4 TODO (future)
- Stop writing to org_settings in billing routes, Stripe webhooks, ensureStripeCustomer
- Drop org_settings table after 30-day readonly window (≈ 2026-08-27)
- Migrate createSession() to populate user_id_v2 automatically

### Validation scripts
- `/tmp/validate-phase3.cjs` — auth flow checks (10/10)
- `/tmp/validate-phase4.cjs` — architectural invariants (19/19)
- `/tmp/validate-signup-flow.cjs` — new signup flow checks (10/10)
