---
name: Stripe checkout add_invoice_items
description: add_invoice_items is NOT valid in stripe.checkout.sessions.create() for API 2026-04-22.dahlia — use stripe.invoiceItems.create() instead
---

## Rule

Do NOT use `add_invoice_items` (at any nesting level) in `stripe.checkout.sessions.create()`.

**Why:** Stripe API version `2026-04-22.dahlia` returns `parameter_unknown` for this parameter in checkout sessions. It is only valid in `stripe.subscriptions.create()` and `stripe.subscriptionSchedules`.

- `subscription_data[add_invoice_items]` → `parameter_unknown`
- `add_invoice_items` (top-level) → `parameter_unknown`

Both were confirmed live against Stripe API with `stripe@22.1.0`.

## How to apply

For subscription checkout sessions that need to charge one-time items (e.g. AI credit packs):

1. If `stripeCustomerId` exists before creating the session: call `stripe.invoiceItems.create({ customer, price, quantity })` for each one-time item. These pending invoice items are automatically included in the customer's first subscription invoice.

2. If no customer yet (Mode B / anonymous checkout): pass the one-time items in session `metadata` only. Handle them post-checkout via webhook (`checkout.session.completed`).

## Code location

`artifacts/api-server/src/routes/public-billing.ts`, Case 1 (`checkoutType === "subscription"`).

## Downgrade during trial — response fix

`stripe.subscriptions.update()` is called for both upgrades and trialing downgrades. The JSON response must use `{ downgrade: true }` when `isDowngrade === true`, even if `effective: "now"`. Only active (non-trialing) downgrades use the schedule path → `effective: "period_end"`.
