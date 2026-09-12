---
name: createSession throw-on-failure
description: createSession now throws on persistent DB failure instead of silently returning an orphaned token.
---

## The bug

`createSession` (services/sessions.ts) caught DB insert errors, logged a warning,
and returned the token anyway. The caller (`login-verify`) set the HttpOnly `fp_token` cookie
with this token. On hard refresh, `session-restore` called `getSession(cookieToken)`, found
no DB row, and returned 401 → user immediately logged out on every Cmd+R.

## The fix

`createSession` now:
1. Retries the INSERT once after 200ms on transient DB error.
2. If both attempts fail, **throws** the error.
3. On success, logs `[sessions] Session row inserted successfully` with token prefix + orgId.

`login-verify` already wraps `createSession` in a try/catch → returns HTTP 503 (retryable)
instead of setting a useless cookie for a ghost session.

## Why

An orphaned cookie (token set but no DB row) is worse than a hard failure:
the user gets silently logged out on every page load with no indication of the problem.
A 503 on login is retryable and surfaceable.

**How to apply:**
- Never return a session token without a confirmed DB row.
- `ON CONFLICT DO NOTHING` fires for duplicate tokens (astronomically rare, idempotent).
- If the duplicate path fires, a warning is logged but the token is still valid (it already exists).
- The retry delay is 200ms — short enough for transient connection pool exhaustion.
