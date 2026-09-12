---
name: Activation email FC-1-skip and webhook INSERT bugs
description: Two root causes preventing activation emails after checkout — webhook INSERT users missing id, and FC-1-skip returning success without re-sending email.
---

## Bug 1 — `activateNewSignup` webhook: INSERT users without explicit `id`

**Rule:** `stripe-webhook.ts` `activateNewSignup` must include `id` in the users INSERT.

**Why:** `users.id` has no DEFAULT in production. The webhook INSERT without `id` fails with null-constraint violation, rolling back the entire activation transaction silently. The pending_signup is NOT consumed (rollback), so finalize-checkout should pick it up — but it creates a race window where both paths can run.

**Fix:** Added `const _wbNewUserId = _wbRandUUID()` (already imported) and included `(id, email, ...) VALUES ($4, $1, ...)`.

---

## Bug 2 — `finalize-checkout` FC-1-skip: returns success without email

**Rule:** When `pending_signup` is already consumed (FC-1-skip), finalize-checkout MUST attempt to re-send the activation email before returning.

**Why:** The webhook may consume the token and commit the user/org, then fail to send the magic link email. FC-1-skip previously returned `{success:true, activationSkipped:true}` without `emailFailed`. The frontend (`checkout-return.html`) checks `emailFailed` to decide what UI to show — without it, it shows "Vérifiez vos emails" even when no email was sent.

**Fix:** In FC-1-skip block:
1. Read `_fcPendingRow?.email` (now declared outside inner try block as `_fcPendingRow`)
2. Look for an existing valid `magic_link_tokens` row for that email
3. If none, mint a fresh 32-byte hex token and INSERT it
4. Call `sendActivationMagicLink` via the same mailer
5. Return `{success:true, activationEmailSent:true}` on success, `{emailFailed:true}` on failure

---

## E2E chain proof (2026-08-16, dev server local)

| Step | Result |
|------|--------|
| login-request → server | ok:true, debugLink returned |
| Resend email | ID `6d3d25df`, to `support@flowpoint.pro`, **delivered**, 20:23:35 |
| Token in DB | `f52304287f…` (64 hex chars) |
| login-verify | ok:true, session token returned |
| /api/me | email=support@flowpoint.pro, plan=Pro |
| Replay token | "Ce lien a déjà été utilisé" — correct |
| Session persist | /api/me with same Bearer → ok |

**Note:** Resend domain `flowpoint.pro` verified ✓. From-field `noreply@flowpoint.pro` confirmed. The same RESEND_API_KEY is used both locally and in production.

---

## `_fcPendingRow` scoping fix

The variable `_fcRow` was declared INSIDE the inner try block and was out of scope at FC-1-skip. Renamed to `_fcPendingRow`, declared with `let` before the inner try block.
