---
name: Add-on V1 test-only boundary
description: Scope and release restrictions for the FlowPoint add-on V1 refactor.
---

Keep this refactor on the `Test-Replit` branch and use Stripe test mode or explicit simulation. Do not change Flowpoint production, production PostgreSQL, or Stripe live, and do not make a new offer purchasable in production without the user's explicit authorization.

**Why:** the user explicitly requires the add-on mapping, features, prices, permissions, and purchase paths to be validated in test/simulation first.

**How to apply:** keep PRs targeted to Test-Replit, preserve protected add-ons and validated plan inclusions, and fail closed for production entitlement simulation.
