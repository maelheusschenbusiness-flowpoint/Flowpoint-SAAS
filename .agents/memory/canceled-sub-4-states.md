---
name: Canceled subscription 4-state routing
description: billing.ts upgrade handler must query Stripe live before routing any canceled-status org
---

## Rule
When `subscriptionStatus === "canceled"` AND `stripeCustomerId` is set, the backend must query Stripe **before** deciding what to do. The DB value alone is not authoritative.

```
canceled (DB) + live sub found in Stripe  →  State A/B: cancel_at_period_end
canceled (DB) + no live sub + isDowngrade →  State C: DB-only plan update
canceled (DB) + no live sub + upgrade     →  State C: reactivation checkout
canceled (DB) + resource_missing in Stripe → State D: orphaned customer cleanup → fresh checkout
```

**Why:** Stripe keeps a subscription `active` even when `cancel_at_period_end = true`. A DB-normalized "canceled" status can represent any of the four states above. Routing without checking Stripe produces either a wrong reactivation checkout (for cancel_at_period_end) or a duplicate subscription (for upgrade on still-active sub).

**How to apply:**
- `billing.ts` upgrade handler ~line 789: three-way Promise.all (activeSubs + trialingSubs + openSessions) in the `if (billingCtx.subscriptionStatus === "canceled")` block
- If live sub found: do NOT return early — fall through to the stripeCustomerId block so normal sub.items upgrade/downgrade applies
- If no live sub + isDowngrade: `persistOrgData({ plan })` + return `{ ok: true, noSubDowngrade: true }`
- If no live sub + upgrade: use `openSessions` (already fetched) for idempotency then create reactivation checkout
- `resource_missing` error in the Promise.all: clear `stripe_customer_id` from both `org_settings` and `organizations`, return `noSubscription: true`
