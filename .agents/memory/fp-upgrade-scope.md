---
name: Billing lifecycle handlers scope in dashboard.js
description: window.* billing-lifecycle handlers used by the Plans tab must be defined at renderBilling scope, not inside a sub-tab block
---

Rule: any `window.*` billing-lifecycle handler referenced by buttons on the Plans tab (end trial, cancel, reactivate, upgrade) must be defined at renderBilling scope, before the plans sub-block — never only inside another sub-tab's block (e.g. addons).

**Why:** a sub-tab block only executes when that tab renders. A user landing directly on the Plans tab gets `undefined` handlers and dead buttons — this exact bug has now occurred twice (upgrade handler, then the end-trial modal).

**How to apply:** when adding a billing lifecycle handler, define it in the shared hoisted block above the plans sub-block; keep only addon-specific handlers inside the addons sub-block.
