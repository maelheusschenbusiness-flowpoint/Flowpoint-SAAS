---
name: Webhook deactivation race — expand missing
description: stripe-webhook.ts persistAddonsFromSubscription deactivation phase wrongly wipes all paid addons immediately after activating them because subscriptions.list() is called without expand
---

# Webhook deactivation race

## The rule
`stripe.subscriptions.list()` in the deactivation phase of `persistAddonsFromSubscription` MUST include `expand: ["data.items.data.price"]`. Without it, `item.price` can be an object where `.id` is absent (or a bare string), causing `getAddonForPriceId(undefined)` to return null for every item, leaving `aggregateAddonKeys` empty, and deactivating ALL paid addons that were just activated.

**Why:** Stripe API `subscriptions.list()` without expand may return price fields in a partial form depending on the API version and call context. The activation path reads from the webhook payload (always full objects). The deactivation path fetches from the Stripe API a second time and is therefore subject to this truncation.

**How to apply:** Any `stripe.subscriptions.list()` call that subsequently accesses `item.price?.id` must include `expand: ["data.items.data.price"]`. Also make the access defensive: `const priceId = typeof item.price === "string" ? item.price : (item.price as {id?:string}|null)?.id ?? ""`.

## Symptoms
- Dashboard shows 300 monitors (Ultra base) even though Stripe has monitorsPack10 qty=2
- Add-on card shows "Activer" instead of "2 packs actifs"
- org_addons row: active=false, quantity=2 (quantity persisted but addon deactivated)

## Fix location
`artifacts/api-server/src/routes/stripe-webhook.ts` — `persistAddonsFromSubscription()`, the `stripe.subscriptions.list()` call in the deactivation phase (was around line 300, now has `expand: ["data.items.data.price"]`).

## Recovery
After deploying the fix, call `POST /api/billing/reconcile-subscription` (authenticated as org owner) to repair the DB state from live Stripe data without a new purchase.
