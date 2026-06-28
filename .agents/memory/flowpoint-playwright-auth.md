---
name: FlowPoint Playwright auth
description: How to authenticate the Playwright testing subagent against the FlowPoint API server
---

# FlowPoint Playwright Auth Problem

## Problem
The Playwright testing subagent cannot get past the FlowPoint login page.

## Root Cause
FlowPoint auth uses an **HttpOnly cookie** (`fp_token`) set by `POST /api/auth/dev-session` with `x-admin-key` header.
- [API] steps in test plans don't share cookies with the browser context
- `localStorage.setItem('fp_token', ...)` doesn't work because the middleware reads `req.cookies.fp_token`, not localStorage
- Browser-side `fetch('/api/dev-session')` theoretically works but the test agent hasn't been able to execute it reliably before seeing the login redirect

## Workaround Attempts That Failed
1. `localStorage.setItem('token', ...)` then reload — fails, app uses HttpOnly cookie
2. `localStorage.setItem('fp_token', ...)` then reload — fails
3. `fetch('/api/auth/dev-session', {credentials:'include'})` in browser — test agent couldn't execute before redirect
4. [API] POST dev-session → set cookie → navigate — cookies not shared between API and browser context

## Correct Approach (Not Yet Tested)
Use Playwright's native `context.addCookies()` to inject the HttpOnly cookie directly before navigation:
```
[API] POST /api/auth/dev-session → get token from JSON response
[Browser] Set cookie via playwright: name=fp_token, value=<token>, domain=localhost, httpOnly=true, path=/
[Browser] Navigate to http://localhost:8081/
```
The testing subagent may need explicit instructions to set the cookie via Playwright's `browserContext.addCookies()`.

## Alternative
Do all functional testing via curl/API with `Authorization: Bearer <token>` header — the middleware also accepts Bearer tokens.

**Why:** requireAuth middleware accepts EITHER `fp_token` cookie OR `Authorization: Bearer` header.
