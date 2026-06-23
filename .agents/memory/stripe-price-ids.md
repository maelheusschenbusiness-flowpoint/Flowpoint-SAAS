---
name: Stripe live price IDs
description: All 44 confirmed Stripe live price IDs hardcoded in plans.ts as fallbacks (confirmed 23/06/2026)
---

# Stripe Live Price IDs — FlowPoint (confirmed 23/06/2026)

## Plans
- standard: price_1StVzQ9eqtbj6iPBNOLjgwHm (29€/mois — Abonnement Standard)
- pro:      price_1StW0A9eqtbj6iPB8GcUCuwQ (79€/mois — Abonnement Pro)
- ultra:    price_1StW109eqtbj6iPBgiD1uRtP (149€/mois — Abonnement Ultra)

## AI Credits (one-time)
- 50K:  price_1TknW49eqtbj6iPB2zvBynz9 (4€)
- 200K: price_1TknXo9eqtbj6iPBsYW4F6Tu (9€)
- 500K: price_1TknZP9eqtbj6iPBFLPnUbQ0 (19€)

## All 44 price IDs are hardcoded in lib/plans.ts with env var overrides

**Why:** No need for 30+ STRIPE_PRICE_ID_* env vars on Render — prices embedded in code.
**How to apply:** If a price needs updating, change both Stripe AND plans.ts fallback value.
