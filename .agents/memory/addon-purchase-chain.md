---
name: Add-on and AI credits purchase chain
description: End-to-end purchase flow for fpBuyAICredits and fpActivateAddon — verified architecture, known gaps fixed 2026-08-16
---

## AI Credits (fpBuyAICredits)

Chain: pricing.html?from=dashboard → checkout.html → checkout-payment.html → POST /api/public/payment-intent → Stripe PaymentElement (mode=payment, one-time) → checkout-return.html Case A → POST /api/public/finalize-checkout → INSERT ai_credit_purchases ON CONFLICT DO NOTHING → store.broadcast(ai:credits_added) → /api/ai-credits → getAIUsageStats SELECT SUM(credits) FROM ai_credit_purchases.

No webhook involved for this path (payment_intent.succeeded only fires for type=ai_credits metadata, not set here). Finalize-checkout is the sole credit-granting step.

**Why:** priceIds in payment metadata don't include type=ai_credits, so the webhook exit-guard fires; finalize is the intended path.

**How to apply:** never assume the stripe webhook credits AI packs for the PaymentElement flow. Check finalize-checkout.

## Recurring Add-ons (fpActivateAddon)

Chain: pricing.html?from=dashboard → checkout.html → checkout-payment.html → POST /api/public/payment-intent → Stripe PaymentElement (month 1 charge) → checkout-return.html Case A → POST /api/public/finalize-checkout.

In finalize-checkout (public-billing.ts):
1. Idempotency: reuse existing sub if same origin_intent already provisioned.
2. **Preferred**: if existing active/trialing subscription found that is NOT a checkout_payment_addons sub → add items via stripe.subscriptionItems.create({ proration_behavior:"none" }) — no second subscription.
3. **Fallback**: no existing plan sub → stripe.subscriptions.create (with 30-day trial covering month 1).

Immediate entitlement: activateAddon() writes org_addons; webhook reconcileAddons is long-term source of truth.

**Why:** creating a second subscription was the original behavior but user requires add-ons on existing subscription. The preferred path adds items with proration_behavior:"none" since month 1 was already collected.

**How to apply:** if changing finalize-checkout recurring-addon logic, always test both paths: no-existing-sub (fallback) and has-existing-sub (add items).

## Confirmation UI

checkout-return.html Case A (payment_intent param) now handles:
- checkoutType=ai_credits_only → showAiCreditsSuccess(credits) → dashboard#billing
- checkoutType=addon_only → "Add-on activé!" → dashboard#billing
- awaitingWebhook → poll billing/verify
- isNewSignup → magic link sent
- generic → "commande confirmée" → dashboard

## SSE broadcasts from finalize-checkout

store is statically imported in public-billing.ts. Broadcasts added (wrapped in try/catch):
- ai:credits_added after INSERT into ai_credit_purchases
- fp:addon:activated for each recurring add-on after activateAddon()

## Test coverage

addon-only-checkout.test.ts has 11 tests covering:
- Empty-plan quote (add-on-only cart)
- AI credits one-time quote
- PaymentIntent creation
- finalize-checkout no-existing-sub fallback (subsCreated length=1, subsItemsCreated length=0)
- finalize-checkout has-existing-sub preferred path (subsCreated length=0, subsItemsCreated length=1 with proration_behavior:none)
- AI credits idempotency (ON CONFLICT)
- Auth guard (401 without session)
