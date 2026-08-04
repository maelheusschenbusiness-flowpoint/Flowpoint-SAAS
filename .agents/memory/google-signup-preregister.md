---
name: Google signup continuation
description: Behavioral rule for OAuth signups that are pending billing
---
Rule: a pending_billing OAuth signup must resume at plan selection with a valid pre-registration token, and the redirect is fail-closed — if the pre-registration record can't be persisted, redirect with a retryable error instead of an empty token.
**Why:** no session is issued while pending_billing and checkout requires the pre-registration token; a bare or token-less redirect loops the user back to sign-in or strands them at a plan screen that can't check out.
**How to apply:** any new OAuth/signup provider must persist the pre-registration server-side before handing the user to the plan chooser, and must never redirect into the funnel on a failed write.
