# Billing and targeted QA regressions — 2026-09-05

Branch: Test-Replit. Baseline: 84ebfbe98c1b74dc76ec52098f5b287504fe2738.

## Diagnosed code paths

- dashboard.js: fpGoToPricing routed inactive subscribers to public pricing with a signup cart.
- auth.ts: pre-register accepted non-active users and deleted legacy canceled billing settings. Account existence now blocks pre-registration independently of subscription status; database lookup failures abort the request.
- billing.ts: canceled Ultra → Standard/Pro used a DB-only downgrade, without creating a Subscription. All plans now create a subscription Checkout on the existing Customer when no live subscription remains. Cancel returns to dashboard billing/plans.
- ensure-stripe-customer.ts: stale settings could override the UUID anchor; resource_missing/deleted Customer and failed metadata search could lead to replacement creation. The UUID anchor wins; lookup failures abort; both identity stores persist in one transaction.
- public-billing.ts: the last-resort creation path could be reached by an existing organization. UUID accounts with a persistent anchor must use that Customer; ended accounts without an anchor stop for repair. New signup fallback is preserved; seller attribution is unchanged.
- admin.ts: purge-account selected organizations through membership, then assumed every table had org_id. It now resolves exactly one owned QA organization, rejects shared/multi-org targets and conflicting/shared Customer mappings, and uses the existing schema-aware transactional deletion pipeline.

## QA cleanup contract

DELETE /api/admin/purge-account retains x-admin-key authorization. Supply exact email and/or orgId. Default is dryRun=true. Real deletion requires dryRun=false and confirmEmail exactly matching the preview owner. The target must be internal QA or explicitly listed in QA_CLEANUP_EMAILS (comma-separated exact emails). qa@flowpoint.pro remains protected. No wildcard, no email-pattern heuristic, no broad purge.

Ambiguous matches and orphan accounts without an owned organization are refused; they require separate targeted investigation. The environment allowlist has not been changed here.

## Verification

- 30 passing Vitest tests: actual ensureStripeCustomer service (including concurrency and failure paths) and early session revocation.
- tools/test-billing-regressions.mjs executes the production billing handler for six canceled/ended × Standard/Pro/Ultra scenarios using Stripe stubs, five dashboard navigation states, three onboarding display states and seven QA cleanup guard cases.
- Frontend byte-for-byte equality; JavaScript syntax; backend bundle build; git diff whitespace validation.
- Public /api/version before changes: 84ebfbe98c1b74dc76ec52098f5b287504fe2738.

These are automated local checks, not live Stripe certification. No real account was deleted, no live payment was initiated, and first-login onboarding after a real QA deletion has not yet been visually verified. Live QA requires the exact disposable target and server/Stripe access.
