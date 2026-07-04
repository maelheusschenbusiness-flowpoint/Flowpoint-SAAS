---
name: FlowPoint post-verification checkout redirect
description: How to send new signups to checkout.html (not the dashboard) after magic-link email verification
---

The magic-link verification page (`login-verify.js`) redirects to `sessionStorage.fp_next` if set (falls back to `/api/dashboard/`). Any flow that needs the post-verification landing spot to differ from the dashboard (e.g. sending a brand-new signup straight into checkout instead of the app) should set `sessionStorage.setItem('fp_next', '<path>')` right before calling `/api/auth/signup`, alongside `localStorage.setItem('fp_cart', JSON.stringify({plan, addons}))` if the target page reads a cart (checkout.html does).

**Why:** The checkout/payment flow (`checkout.html` → `checkout-payment.html` → `/api/public/payment-intent`) is intentionally unauthenticated (no session check, no email/name fields) — it relies entirely on `fp_cart` in localStorage for what to charge. There's no signup-with-payment combined form, so the only way to route a new user into checkout post-signup is via the `fp_next` sessionStorage hook consumed after email verification.

**How to apply:** Reuse this pattern (set `fp_cart` + `fp_next` before signup) whenever a CTA needs "sign up then land on X" behavior instead of "land on dashboard".
