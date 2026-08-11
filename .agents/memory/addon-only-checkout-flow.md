---
name: Add-on-only checkout for active subscribers
description: How an empty-plan cart from the dashboard must quote, charge, and provision add-ons
---

# Add-on-only cart (plan:"") from a subscribed user

**Rule 1 — quoting:** every public quote/payment entry point must accept an empty plan when the cart has billable add-ons. For an authenticated subscriber, resolve their EXISTING plan server-side (`inclusionPlan` in the quote selection) so plan-bundled add-ons are never charged. Never trust a browser-declared plan for inclusions.
**Why:** completion review rejected a release where the dashboard's mandated pricing/cart flow built `plan:null` carts that the quote route rejected as "plan required" — subscribers could not buy add-ons at all.

**Rule 2 — provisioning:** finalize-checkout must NOT return early with "credits activés" for every plan-less cart. A plan-less cart with recurring add-ons needs: month-2 Stripe subscription (`trial_end` +30d — month 1 was the PaymentIntent), immediate `activateAddon` entitlement, and idempotency via `origin_intent` metadata on the subscription. AI packs use deterministic purchase ids `acp_pi_<intentId>_<pack>` so webhook + finalize can never double-credit. If provisioning fails after the charge, return 500 with an explicit "payment received but not activated" error — never silent success.

**How to apply:** any new checkout entry point must handle three cart shapes: plan-only, plan+add-ons, add-ons-only. Test with an active subscriber context (mock billing-context, inject fake Stripe via stripe-factory with NODE_ENV forced off "production").
