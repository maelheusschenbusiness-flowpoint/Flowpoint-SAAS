---
name: checkout-complete direct magic link path
description: GET /api/auth/checkout-complete now sends the magic link directly instead of relying solely on the Stripe webhook.
---

## The bug

`GET /api/auth/checkout-complete` returned `{ emailSent: true }` unconditionally after verifying Stripe payment,
but never actually sent the email — it delegated entirely to the `checkout.session.completed` webhook.
If the webhook was slow or missed, the user saw "Vérifiez vos emails" forever.

## The fix

The endpoint now checks the DB directly:

1. **User not yet created** (`users` table has no row for the email) → return HTTP 402.
   Frontend (`checkout-return.html` / `runCheckoutComplete`) retries every 2s up to 5 times total.

2. **User created, valid unused `magic_link_tokens` row exists** → webhook already handled it, return `emailSent: true`.

3. **User created, no valid token** → webhook ran but email failed, OR token was consumed.
   Generate a fresh 32-byte hex token, insert into `magic_link_tokens`, call `mailer.sendActivationMagicLink()` directly.
   Return `emailSent: true/false` accurately.

4. **Email delivery failed** (`emailFailed: true` in response) → `checkout-return.html` shows
   "Compte activé, email échoué → Se connecter →" UI instead of a generic error.

## Why

The webhook is async and can be delayed, misconfigured, or silently caught.
Having `checkout-complete` as a direct reliable path means the magic link is always sent,
regardless of webhook state.

## How to apply

- The Stripe `checkout.session.completed` webhook still inserts a token and sends the email —
  it's a FIRST attempt. `checkout-complete` is the guaranteed second path.
- Never return `emailSent: true` from `checkout-complete` without verifying an actual send or existing token.
- The frontend 402 retry path handles webhook latency (up to ~10 seconds).
