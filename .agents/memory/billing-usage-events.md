---
name: Cumulative usage accounting + paid-addon Stripe sync
description: Durable billing decisions — usage counters never decrement; charge-affecting routes are owner-only; Stripe billed before entitlement granted
---

## Usage counters never decrement
Billing usage shown to users combines live monthly row counts with an append-only usage-events feed, taking the max per period.
**Why:** deleting a report/monitor used to "refund" quota, breaking billing coherence.
**How to apply:** record an event at action time (create/export) and never derive quota consumption from row counts alone. Event recording is fire-and-forget and must never fail the primary action.

## Charge-affecting endpoints are owner-only
Any route that can create, alter, or stop charges (add-on activate/deactivate, AI-credit checkout, upgrades, portal) must carry the ownerOnly guard.
**Why:** code review rejected member-accessible purchase routes as broken authorization.

## Stripe before entitlement
For paid add-ons: bill on the live subscription (idempotent subscription-item add/remove with prorations) BEFORE flipping the DB entitlement; on Stripe failure return 502 and change nothing; roll back the Stripe item if the DB grant fails afterward. Included-in-plan add-ons and one-time credit packs are never subscription items.

## Next invoice date
Trialing Stripe subscriptions may lack current_period_end — fall back to trial_end when exposing the next billing date.
