---
name: Add-on V1 test-only boundary
description: Scope and release restrictions for the FlowPoint add-on V1 refactor.
---

Keep this refactor based on the current `Test-Replit` HEAD and use Stripe test mode or explicit simulation. Do not change Flowpoint production, production PostgreSQL, or Stripe live. Keep `ssoEnterprise` in the catalogue as unavailable; do not add Clerk or replace the existing authentication. The user has approved these new monthly add-ons and target prices: GBP Performance & Leads (€15), Local Presence Optimizer (€9), Local Landing Opportunities (€15), Conversion Opportunity Engine (€12), SEO Change Impact (€15), Agency Portfolio Priorities (€19), Technical SEO Fix Verification (€19), and Organic Campaign Tracker (€12). The plan inclusion distribution Standard 1 / Pro 6 / Ultra 10 is approved in principle, with historical customer rights preserved.

**Why:** the user explicitly requires the add-on mapping, features, prices, permissions, and purchase paths to be validated in test/simulation first, and has forbidden changes to LIVE Stripe and Production.

**How to apply:** implement real, configurable, persistent behavior rather than catalogue-only cards. Use separate identifiers for replacement products so existing customers retain their old add-on entitlements; keep legacy rights and four extra Ultra entitlements intact. Test-only pricing and checkout changes are allowed within the approved targets, but never edit LIVE Stripe or Production. Prefer existing integrations and data. Work in dedicated branches and integrate incrementally through `Test-Replit`, green CI, and Render Test. Avoid unrelated broad audits/certifications; targeted checks for the changed feature remain required.

The user supplied the definitive retained-add-on improvement list in an attached specification and explicitly said not to ask for that selection again. Preserve the six protected add-ons, Custom Domain, and historical customer rights; do not rerun certifications for existing add-ons.

**Why:** the user confirmed these decisions had already been communicated and asked to proceed without another validation round.

**How to apply:** use the supplied list as the scope for parallel improvements, and continue with GBP Performance & Leads first.
