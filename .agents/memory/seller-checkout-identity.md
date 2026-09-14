---
name: Seller checkout identity
description: Customer selection rules when seller signup tokens and browser sessions coexist
---

For checkout, a valid pre-registration token is authoritative for a new seller signup; an expired or invalid token falls back to the authenticated organization session. A valid token must never make Stripe use an unrelated session Customer, and an authenticated UUID session must never activate a pending signup from stale token metadata.

**Why:** Browser localStorage and cookies can outlive an account transition. Resolving the session first creates a PaymentIntent for one Customer and finalizes it against another, correctly triggering `billing_customer_mismatch`.

**How to apply:** Keep seller attribution additive. Resolve the organization Customer from the signup token only for the token flow; resolve existing-account Customer IDs with `ensureStripeCustomer`; keep the mismatch guard fail-closed.