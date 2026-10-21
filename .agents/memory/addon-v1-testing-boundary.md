---
name: Add-on V1 test-only boundary
description: Scope and release restrictions for the FlowPoint add-on V1 refactor.
---

Keep this refactor based on the current `Test-Replit` HEAD and use Stripe test mode or explicit simulation. Do not change Flowpoint production, production PostgreSQL, or Stripe live. Keep `ssoEnterprise` in the catalogue as unavailable; do not add Clerk or replace the existing authentication.

**Why:** the user explicitly requires the add-on mapping, features, prices, permissions, and purchase paths to be validated in test/simulation first.

**How to apply:** proceed one add-on at a time without asking for a new category. Do not change prices, billing rules, entitlements, quotas, Stripe, activation flows, or the six protected add-ons. Prefer existing infrastructure and APIs. Keep each PR narrowly scoped to `Test-Replit`, wait for green CI, and verify each PR is integrated before starting another. Unit tests alone are not proof of operation; report only architecture decisions or external dependencies that need the user's intervention.
