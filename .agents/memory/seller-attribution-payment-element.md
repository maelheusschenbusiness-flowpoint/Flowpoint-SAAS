---
name: Seller attribution Payment Element propagation
description: Referral signups must preserve seller attribution across direct finalization, Stripe metadata, and later commission events.
---

For referral signups, every activation path must copy the validated seller from `pending_signups` into the canonical organization, and Payment Element seller metadata lookup must finish before creating the SetupIntent or PaymentIntent.

**Why:** The browser E2E exposed two independent gaps: direct `finalize-checkout` could activate an organization without `seller_id`, and a fire-and-forget lookup raced Stripe intent creation, so Customer and Subscription metadata lost the seller even though `pending_signups` was correct.

**How to apply:** When changing seller or checkout flows, verify `pending_signups`, `organizations`, SetupIntent/PaymentIntent metadata, Customer metadata, and Subscription metadata. Trial activation has no commission yet; commission is created on the first real paid invoice and must remain idempotent.