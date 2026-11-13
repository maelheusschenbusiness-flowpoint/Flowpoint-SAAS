---
name: Addon separate subscription P0-B
description: Architecture decision — paid add-ons live on a separate Stripe subscription per org with an independent billing cycle
---

# Add-on separate subscription architecture

## The rule
Paid add-ons MUST stay off the plan subscription for new purchases. The public PaymentIntent checkout creates an idempotent dedicated add-on subscription per checkout intent with `metadata.addonSub="true"` and a renewal boundary 30 days after payment. Other direct service activations reuse the org's existing dedicated add-on subscription. Historical plan-subscription items remain where they are.

**Why:** Plan items inherit the plan renewal date, while the PaymentIntent already collects the first add-on month. A dedicated subscription preserves an independent paid period and prevents retrying checkout from adding duplicate Stripe items. Multiple purchases can create multiple add-on subscriptions, so entitlement quantities must be summed across every live subscription and deactivation must remove matching items from all of them.

**How to apply:**
- PaymentIntent checkout: create/reuse by intent idempotency key; set `trial_end` 30 days after payment; tag `addonSub`, `source`, `origin_intent`, and org ID metadata.
- Direct service activation: find or create the org's dedicated add-on subscription with `billing_cycle_anchor: "now"`.
- Webhook reconciliation: sum quantity add-ons over all live subscriptions (active, trialing, past_due); never revoke unrelated add-ons on `subscription.created`.
- Deactivation: remove matching items from both the legacy plan subscription and every live dedicated add-on subscription; cancel dedicated subscriptions only when empty.
- Backward compatibility: existing items on the plan subscription stay there; do not automatically migrate them.

## Migration procedure for existing items on plan sub
To move a legacy add-on item (e.g., monitorsPack10 × 2 on plan sub) to the addon sub:
1. Deactivate: `POST /api/addons/monitorsPack10/deactivate` → removes from plan sub
2. Re-activate: `POST /api/addons/monitorsPack10/activate { quantity: 2 }` → creates addon sub with fresh cycle
Do NOT auto-migrate without user consent (creates a new billing event and changes the renewal date).

## Implementation location
`artifacts/api-server/src/services/addon-stripe-sync.ts` — `syncAddonWithStripe()` rewritten with backward-compat logic.
