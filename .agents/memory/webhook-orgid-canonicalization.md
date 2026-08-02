---
name: Webhook orgId canonicalization
description: Stripe webhook must map email-shaped orgId to UUID organizations.id before persisting plan/status
---
Rule: any orgId resolved from Stripe metadata may be a legacy email; before persistSubscriptionMeta/persistAddonsFromSubscription, canonicalize non-UUID orgId via `SELECT id FROM organizations WHERE lower(owner_email)=lower($1)`.

**Why:** checkout metadata carries email-as-orgId while activation creates a UUID org. persistOrgData skips the organizations write for non-UUID ids (mirror to org_settings only), so a Stripe Ultra update landed in email-keyed org_settings while canonical organizations.plan stayed Standard — dashboard (/api/me is organizations-first) showed the wrong plan. Also caused prod `invalid input syntax for type uuid: <email>` errors.

**How to apply:** the canonicalization block lives in stripe-webhook.ts right after the 4-step orgId resolution, before the idempotency guard. Keep it for any new webhook event handlers.

Related fixes same session: mailer.ts now falls back Resend→SMTP on Resend failure (sendViaSmtp helper); activateNewSignup logs the real mail result (ok:false = error log, never a fake "sent").
