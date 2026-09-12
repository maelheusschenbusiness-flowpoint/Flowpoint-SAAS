---
name: Public billing authenticated Customer anchor
description: Public billing routes run before orgContext and must resolve authenticated dashboard sessions before creating Stripe intents
---

For an authenticated dashboard purchase, public billing endpoints cannot rely on `req.orgId` being populated by the protected-route middleware. They must resolve the session token before Stripe PaymentIntent/SetupIntent creation and use the resulting org to load the canonical `organizations.stripe_customer_id`.

**Why:** The public billing router is registered before `orgContext`; plan purchases therefore created an Intent without the canonical Customer, and finalization compared a fallback Customer against the organization Customer.

**How to apply:** Keep the finalize mismatch check fail-closed. Fix the producer first: resolve the session for plan and add-on carts, propagate the resolved org, and call `ensureStripeCustomer` so an existing organization Customer is reused and stale `pending_signups` data cannot replace it.