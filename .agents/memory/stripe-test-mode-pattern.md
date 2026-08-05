---
name: Stripe test-mode cert pattern
description: How getStripeKey() and webhook verification work for isolated Stripe test-mode E2E certs
---

## getStripeKey() safety gate

Use `sk_test_` prefix check — NOT `NODE_ENV !== "production"` — because NODE_ENV is permanently `production` in this Replit environment.

```typescript
export function getStripeKey(): string {
  if (process.env["STRIPE_TEST_MODE"] === "true") {
    const testKey = process.env["STRIPE_TEST_KEY"] || process.env["STRIPE_TEST_SECRET_KEY"];
    if (testKey?.startsWith("sk_test_")) return testKey;
  }
  return process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
}
```

**Why:** NODE_ENV=production is always set in the Replit environment (even for dev). Guarding on `NODE_ENV !== "production"` silently falls through to the live key. The `sk_test_` prefix is a safer gate — it can never be faked by a live key.

## Webhook test secret fallback

Same reasoning: drop `NODE_ENV !== "production"` guard from webhook fallback. `STRIPE_TEST_WEBHOOK_SECRET` presence is the safety gate.

```typescript
if (testWebhookSecret) {  // no NODE_ENV check
  event = stripe.webhooks.constructEvent(rawBody, sig, testWebhookSecret);
}
```

**Why:** The test webhook secret (`whsec_...`) is only valid against events signed by the registered test endpoint. A live event will never pass verification with a test secret.

## Test cert environment variables

- `STRIPE_TEST_MODE=true` — activates test key selection in `getStripeKey()`
- `STRIPE_TEST_KEY` — `sk_test_...` secret from Stripe test-mode dashboard
- `STRIPE_TEST_WEBHOOK_SECRET` — `whsec_...` signing secret from the registered Stripe test webhook endpoint
- `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_STANDARD`, `STRIPE_PRICE_AI_50K`, `STRIPE_PRICE_ID_10MONITORS` — test-mode price IDs

## HMAC verification shortcut

To confirm a stored `STRIPE_TEST_WEBHOOK_SECRET` is correct without reading the secret, extract the payload+header from the server error log and compute locally:
```
signed = timestamp + "." + raw_payload_bytes
HMAC-SHA256(signed, known_secret) === v1 from header → secret is correct
```
If match succeeds but server still rejects → the stored env var has a wrong value (user typo on form).

## Registered test webhook endpoint

`we_1U17g79eqtbj6iPBomfUnTvv` → `https://637b3722-0749-4a98-8b79-abfeb0a1d3ce-00-2vuijftxq94iq.picard.replit.dev/api/billing/webhook`

## Addon checkout mode

`monitorsPack10` is a **recurring** price → checkout sessions must use `mode: "subscription"`, not `mode: "payment"`. Payment mode rejects recurring prices with 400.

## monitorsPack10 addon definition gap

`ADDON_DEFINITIONS` in `addons-service.ts` was missing `monitorsPack10` (only had `monitorsPack50`). `activateAddon()` returns false with "Unknown addon key" warning for any key not in `ADDON_DEFINITIONS`. Fix: add it to the map.

## E2E cert script location

`artifacts/api-server/tools/e2e-billing-cert-v2.mjs` — requires pre-cleanup at top of script to wipe leftover data from crashed prior runs. Test org ID: `e2ec0000-b222-4000-a000-000000000042`.

## monitorsPack10 — formally removed (not a real product)

`monitorsPack10` was a partial abandoned implementation. The canonical product is `monitorsPack50` only.
- Removed from: `ADDON_DEFINITIONS`, `plans.ts` price map, `QTY_ADDONS`, `public-billing.ts` unit prices.
- Deleted env var: `STRIPE_PRICE_ID_10MONITORS`.

## STRIPE_PRICE_ID_50MONITORS env var state after cert

Set to test price `price_1U18LU9eqtbj6iPBlG1Ycg6Y` (Stripe test mode) for the cert.
Live price fallback is hardcoded in plans.ts: `"price_1TYonA9eqtbj6iPB4t0y0qzn"`.
Before going live: reset env var to the live price OR clear the env var to use the hardcoded fallback.
Same for `STRIPE_TEST_MODE=true` — must be removed/set to false in production.
