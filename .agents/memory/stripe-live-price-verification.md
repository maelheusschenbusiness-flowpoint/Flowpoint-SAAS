---
name: Stripe live price verification
description: Safe procedure for switching a preview from Stripe TEST to LIVE billing.
---

Stripe price IDs are mode/account-specific. A price ID that works in TEST can return `resource_missing` with the LIVE key even when the amount and product name look correct.

**Why:** The configured Standard price was valid in TEST but absent in LIVE; switching the preview without checking would have produced a broken checkout or encouraged a dangerous fallback.

**How to apply:** Before enabling LIVE billing, retrieve the intended active recurring price with the LIVE key, verify `livemode`, currency, amount, interval, and product identity, then configure the preview with that exact ID. Keep the preview warning explicit because successful checkouts create real Stripe objects.