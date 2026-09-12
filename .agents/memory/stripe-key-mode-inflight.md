---
name: Stripe key-mode in-flight isolation
description: Prevent TEST/LIVE Customer lookups from sharing an in-process ensure promise.
---

**Rule:** Every `ensureStripeCustomer` call that can overlap with checkout must pass the mode-selected Stripe key explicitly; the in-process lock is keyed by organization only, not by Stripe account or mode.

**Why:** A login background repair using the LIVE default can occupy the shared promise just before a TEST checkout. The checkout then inherits the LIVE `resource_missing` failure and creates an intent without the canonical Customer.

**How to apply:** Resolve the key through the canonical mode-aware selector and pass it to Customer resolution. Regression coverage must include the login-then-checkout sequence in Stripe TEST mode.