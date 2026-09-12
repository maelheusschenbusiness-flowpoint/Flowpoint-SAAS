---
name: Stripe TEST public key and return
description: Non-obvious Stripe TEST behavior for public Payment Element flows.
---

The public Stripe key returned to the browser must match the secret key mode: `sk_test_` requires the TEST publishable key, never the live public key.

**Why:** A live `pk_live_` lets Stripe.js load but prevents a TEST SetupIntent from producing a usable Payment Element. Separately, a successful card `confirmSetup()` or `confirmPayment()` can resolve with an intent and no browser redirect when no authentication step is required.

**How to apply:** Select the publishable key from the active Stripe secret-key mode, and after a successful confirmation explicitly route to the checkout-return URL with the confirmed intent ID and `redirect_status`; do not rely only on Stripe's automatic redirect.