---
name: FlowPoint Stripe Elements payment flow
description: Architecture of the custom payment page (Stripe Elements, not embedded checkout); trial vs add-on billing logic.
---

# FlowPoint Stripe Elements Payment Flow

## Rule
checkout-embedded.html is replaced by checkout-payment.html. Do NOT reintroduce stripe.initEmbeddedCheckout() or ui_mode: "embedded_page".

## Architecture

**Files:**
- `artifacts/flowpoint-export/checkout-payment.html` — full FlowPoint-branded payment page
- `artifacts/api-server/src/routes/public-billing.ts` — `POST /api/public/payment-intent` + `POST /api/public/finalize-checkout`
- `artifacts/flowpoint-export/checkout-return.html` — handles payment_intent / setup_intent URL params

**Flow:**
1. checkout.html → startPayment() → /checkout-payment.html
2. checkout-payment.html → POST /api/public/payment-intent → returns { clientSecret, publishableKey, mode, immediateAmount }
3. Stripe Payment Element mounted, user enters card
4. mode=payment → stripe.confirmPayment(); mode=setup → stripe.confirmSetup()
5. Stripe redirects to /checkout-return.html?payment_intent=xxx OR ?setup_intent=xxx
6. checkout-return.html → POST /api/public/finalize-checkout → creates Stripe Customer + Subscription
7. Redirect to /success.html

## Trial / add-on billing logic

- **Plan only (no paid add-ons)** → SetupIntent (0€ today) → subscription with trial_period_days=14
- **Plan + add-ons** → PaymentIntent for add-on total (charged immediately) + subscription with trial for plan
- **AI credits only** → PaymentIntent for credit total, no subscription
- Add-ons are billed NOW via PaymentIntent, then recurring via subscription items starting after trial

## ADDON_PRICES_EUR_CENTS
Hardcoded EUR prices (in cents) live in `public-billing.ts` and mirror ADDON_INFO.price × 100 in checkout-payment.html. Keep them in sync if prices change.

**Why:** Stripe only stores price IDs, not amounts easily accessible without an extra API call. Hardcoding avoids latency and keeps the payment-intent endpoint fast.

## app.ts route
Route is `/checkout-payment` and `/checkout-payment.html`. The old `/checkout-embedded` route was replaced.
