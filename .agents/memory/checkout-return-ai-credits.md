---
name: checkout-return.html AI credits handling
description: How checkout-return.html routes AI credit purchases vs plan subscriptions
---

## Rule
`billing/verify` now returns `checkoutType` in its response. `checkout-return.html` branches on it:

- `checkoutType === "ai_credits_only"` or `"ai_credits"` → call `showAiCreditsSuccess(data.credits)` → shows "X tokens added" UI → redirects to `dashboard.html#billing`
- anything else → existing plan-subscription path → redirects to `dashboard.html?plan_activated=1`

**Why:** AI credit purchases are one-time payments with no subscription; showing "plan activated" after an AI pack purchase is wrong and confusing. The webhook already credited the org before checkout-return.html is called, so the return page just needs to confirm it.

**How to apply:** 
- `billing/verify` (`GET /api/billing/verify`) reads `session.metadata.flowpoint_checkout_type` and `session.metadata.type` to detect AI credits; returns `{ ok: true, checkoutType, credits }` early (no persistOrgData call for AI credits sessions).
- `checkout-return.html` `showAiCreditsSuccess(credits)` element IDs: `fp-spinner` (hide), `fp-check` (show), `fp-title`, `fp-sub`.
