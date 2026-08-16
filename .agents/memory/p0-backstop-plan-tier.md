---
name: P0 backstop plan-tier decision
description: stripe-webhook.ts checkout.session.completed P0 backstop uses plan tier (standard<pro<ultra) to decide which duplicate subscription to cancel — not trial status or creation order.
---

## Rule
When the P0 backstop in `checkout.session.completed` finds a duplicate active/trialing subscription:
- Compare `PLAN_TIER[planNorm]` (new sub) vs `PLAN_TIER[conflict.metadata.plan]` (existing subs).
- If new sub tier **>** all conflict tiers → new sub is the legitimate one; cancel conflicts.
- Otherwise (new sub tier ≤ max conflict tier) → new sub is the duplicate; cancel new sub (conservative).

## Why
Trial status cannot reliably distinguish the legitimate sub: whichever checkout finalized *first* gets `grantTrial=true` because `hasSubscriptionHistory` is re-evaluated at finalize-checkout time. In a reversed-order scenario (Standard finalizes first → gets trial; Pro finalizes second → no trial), the trial-based heuristic would wrongly keep Standard.

Plan tier is stable: the user's *intended* plan is always encoded in session metadata, regardless of finalization order.

## How to apply
The map `{ standard: 1, pro: 2, ultra: 3 }` lives in the backstop block of `handleStripeWebhook` (stripe-webhook.ts). Any new plan added to the hierarchy must be added here too. The conflict's plan comes from `conflict.metadata?.["plan"]` (set by finalize-checkout).

## P0 certification
All 15 scenarios (A–L + sub-tests) PASS with real Stripe TEST objects. Cert script at `/tmp/cert_p0.cjs` (run with `STRIPE_TEST_KEY` + `STRIPE_TEST_WEBHOOK_SECRET`). Verified 2026-08-16.
