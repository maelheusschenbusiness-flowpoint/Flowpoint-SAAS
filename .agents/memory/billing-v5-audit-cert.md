---
name: Billing V5 audit cert — P0/P1 fixes
description: Root causes and fixes from the full billing coherence audit (2026-08-05); patterns to avoid re-introducing the same bugs.
---

## Bugs found and fixed

### P0-1 — addon-stripe-sync.ts bypassed getStripeKey()
**Rule:** Any code that instantiates Stripe must call `getStripeKey()` from `stripe-factory.ts`, never access `STRIPE_LIVE_API_KEY` / `STRIPE_SECRET_KEY` directly.
**Why:** `getStripeKey()` is the only place that checks `STRIPE_TEST_MODE=true` and returns the test key. Bypassing it in test-mode sends live Stripe calls with real money.
**How to apply:** Grep for `STRIPE_LIVE_API_KEY` in service files after any refactor; only `stripe-factory.ts` itself is allowed to read that env var.

### P0-2 — monitorsPack10 ghost product in 6 frontend files
**Rule:** When a product is removed from the backend (`plans.ts` ADDON_PRICE_IDS / `addons-service.ts` ADDON_DEFINITIONS), search ALL frontend files for the key and remove every occurrence before shipping.
**Why:** Frontend ADDON_INFO/ADDON_NAMES maps are display-only; the backend `KNOWN_ADDON_KEYS_PUB` (FLAG_ADDONS ∪ QTY_ADDONS) is the parse-time gate. A key absent from the backend set → 400 "Add-on inconnu" for any user who reaches checkout with that add-on.
**Files that carry addon key maps:** `pricing.html`, `checkout.html`, `checkout-payment.html`, `dashboard.js`, `cancel.html`, `success.html`.

### P0-3 — Legacy duplicate webhook handler in billing.ts
**Rule:** Only `routes/stripe-webhook.ts` may handle Stripe webhook events. `routes/billing.ts` must never contain a second `router.post("/billing/webhook", ...)` block.
**Why:** The legacy block (had `orgId="default"` fallback, no idempotency, no payment_intent handling) was unreachable because `stripeWebhookRouter` is mounted first in `routes/index.ts`. But it's a live grenade: any route-order change would activate a broken handler.

### P1 — ADDON_CATALOG prices in billing-service.ts drifted from ADDON_DEFINITIONS
**Rule:** After changing a price in `ADDON_DEFINITIONS` (addons-service.ts), also update `ADDON_CATALOG` (billing-service.ts). These two catalogs serve different API paths (`/api/addons` vs `/api/billing/plans`) and both are shown to users.
**Correct canonical prices (2026-08-05):**
- monitorsPack50: 19€/mois
- extraSeats: 14€/mois
- retention90d: 9€/mois
- retention365d: 19€/mois
- whiteLabel: 17€/mois
- prioritySupport: included in Pro — NOT in ADDON_CATALOG

### P1 — monitorsPack50 price shown as 29€ in frontend
**Canonical:** 19€/mois in ADDON_DEFINITIONS. Corrected in pricing.html, checkout.html, checkout-payment.html, dashboard.js.

## Certification results (2026-08-05)
All 21 endpoint/invariant checks passed. Build: 0 TypeScript errors.
