---
name: Addon separate subscription P0-B
description: Architecture decision — paid add-ons live on a separate Stripe subscription per org with an independent billing cycle
---

# Add-on separate subscription architecture

## The rule
Paid add-ons MUST be billed on a dedicated Stripe subscription per org, separate from the plan subscription. This gives each add-on an independent monthly billing cycle starting from the activation date.

**Why:** SubscriptionItems on the plan subscription share the plan's billing cycle. If the plan renews on Sep 2 and the user adds a monitorsPack10 on Aug 27, the first add-on charge is prorated to Sep 2 — not 30 days from purchase. The user wants: add-on cycle = purchase_date → +30 days, independent of plan.

**How to apply:**
- Dedicated add-on subscription: `metadata: { addonSub: "true", orgId: "<uuid>" }`, `billing_cycle_anchor: "now"`, `payment_behavior: "default_incomplete"`
- Activation: check plan sub first (legacy), then addon sub, then create addon sub
- Deactivation: remove item from whichever sub holds it; cancel addon sub if it becomes empty
- Backward compat: existing items on the plan subscription stay there and quantity is updated in place — no double billing, no automatic migration

## Migration procedure for existing items on plan sub
To move a legacy add-on item (e.g., monitorsPack10 × 2 on plan sub) to the addon sub:
1. Deactivate: `POST /api/addons/monitorsPack10/deactivate` → removes from plan sub
2. Re-activate: `POST /api/addons/monitorsPack10/activate { quantity: 2 }` → creates addon sub with fresh cycle
Do NOT auto-migrate without user consent (creates new billing event + prorations).

## Implementation location
`artifacts/api-server/src/services/addon-stripe-sync.ts` — `syncAddonWithStripe()` rewritten with backward-compat logic.
