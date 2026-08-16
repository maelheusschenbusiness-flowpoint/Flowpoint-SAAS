---
name: Trial signup activation email — webhook delegation removed
description: Why finalize-checkout always sends the magic-link email immediately, and why sendTrialStartedOnce no longer sends anything.
---

## The rule

`finalize-checkout` (public-billing.ts) must always call `sendActivationMagicLink` for both trial and non-trial signups. The `isTrial: grantTrial` flag selects the right email template. Never delegate the first-login email to a Stripe webhook.

**Why:** The ML-3-TRIAL-SKIP pattern (skip activation email, wait for `customer.subscription.created` webhook → `sendTrialStartedOnce` to send it) caused a silent failure: `activationEmailSent: !!_fcActToken` was truthy because `_fcActToken` is the pre-register token (an *input* to the request), not a signal that any email was sent. Users saw "Vérifiez vos emails" but their inbox was empty because:
1. The webhook could arrive seconds/minutes later (race condition visible to the user)
2. If the webhook failed silently, no email ever arrived
3. There was zero feedback in the response about whether an email was actually sent

**How to apply:**
- ML-3 block in finalize-checkout is unconditional — no `if (grantTrial)` guard around the mailer call
- `sendTrialStartedOnce` in stripe-webhook.ts: after claiming the row, just runs the `UPDATE … SET trial_started_email_sent_at = NOW()` SQL and returns. No magic token lookup, no email send.
- `activationEmailSent` in the final `res.json()` is a plain `true` — reached only after ML-4-OK (early return on ML-4-FAIL ensures this)
- checkout-complete (auth.ts): `emailSent = true` was set unconditionally in two false-positive paths (`hasToken=true` + mailer unavailable, and `hasToken=true` + no token row). Both now set `emailSent = false` and log `ML-FAIL` so the frontend shows the "Connectez-vous directement" fallback.
