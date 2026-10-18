---
name: Add-on inclusion matrix
description: Confirmed FlowPoint V1 plan inclusions and commercial restrictions for the add-on catalog.
---

FlowPoint V1 has 40 existing add-on keys. Keep all six protected add-ons and their current features, prices, quantities, and inclusions unchanged, except that Ultra must inherit all six Pro inclusions. Standard remains €29/month, Pro €79/month, and Ultra €149/month; Pro includes six add-ons and Ultra includes those six plus four: Custom Domain, Behavioral AI, AI Forecasting, and Retention 365 days. Retention 90 days remains included in Pro and is inherited by Ultra. Keyword Domination remains available for separate purchase on Pro and Ultra, but is not bundled in Ultra. The +5 seats price may be €12/month only in a test/simulation context; do not alter live Stripe prices or enable new live offers without explicit authorization.

**Why:** The user explicitly confirmed this matrix after the existing source was found to replace the Pro retention entitlement with the Ultra retention entitlement and to bundle Keyword Domination.

**How to apply:** Keep commercial inclusions, purchase eligibility, and feature entitlements aligned across the canonical catalog, API, dashboard, checkout quotes, and provisioning. Verify that test-only prices use matching test Stripe IDs before enabling them in a checkout path.
