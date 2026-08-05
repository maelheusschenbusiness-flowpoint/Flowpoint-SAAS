---
name: Checkout payment-intent deleted Stripe customer
description: Root cause and fix for "Erreur lors de la création du paiement" when a Stripe customer was deleted externally but its ID remains in the DB.
---

## The bug
`POST /api/public/payment-intent` (called by `checkout-payment.html`) has an authenticated-user path that reads `stripeCustomerId` from the billing context and passes it directly to `stripe.setupIntents.create({ customer: rawId })`. If the Stripe customer was deleted (e.g. by an ops purge), Stripe throws "No such customer" → caught at the bottom catch → `500 { error: "Erreur lors de la création du paiement." }`.

## The fix
In the authenticated-user path of `/api/public/payment-intent`, call `ensureStripeCustomer(orgId, billingCtx, stripeKey)` instead of using `_authCtx.stripeCustomerId` directly. `ensureStripeCustomer` detects deleted customers and creates a new one transparently.

**Why:** Raw `stripeCustomerId` from DB can be a deleted Stripe customer ID. `ensureStripeCustomer` already has the recovery logic (step 2 `resource_missing` path).

**How to apply:** Any endpoint that creates Stripe intents using the DB-stored `stripeCustomerId` for authenticated users must call `ensureStripeCustomer` rather than using the raw ID.

## Secondary bugs also fixed

### fpGoToPricing guard blocked re-subscription
`fpGoToPricing(plan)` had: `if (currentPlan === plan) → show toast → return`. For canceled users on the same plan, this blocked the redirect to pricing.html. Fix: check `_isSubscribed` before applying the guard — only block if subscription is actually active/trialing/past_due.

### pricing.html goToCheckout dead-end for canceled users
`goToCheckout()` showed "Sélectionnez d'abord un plan" when `!isSubscribed && !targetPlan`. For canceled users from the dashboard (addon flow), this was a dead-end. Fix: auto-populate `currentCart.plan = bs.plan` when `bs.plan` is a valid plan, then fall through to the non-subscriber-with-plan branch.

### Billing dashboard "Reprendre un abonnement" hardcoded href
Button was `onclick="window.location.href='/pricing.html'"` — no plan pre-selection. Fixed to use `fpGoToPricing(_resubPlan)` with the current plan extracted from billing state.

### Modal CSS white backgrounds (dark mode)
All confirm/cancel/delete modals had `var(--fp-card-bg,#fff)` or `var(--fp-bg,#f8fafc)` as CSS fallback — showed white in dark mode when CSS vars not yet resolved. Changed fallbacks to `#0d1525` / `#0a1020`.
