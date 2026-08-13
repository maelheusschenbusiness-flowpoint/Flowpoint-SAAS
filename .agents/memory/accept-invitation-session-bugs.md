---
name: Accept-invitation session & role bugs
description: Token storage mismatch + missing cookie in invitation accept flow causes wrong role display and session loss on refresh
---

## Rules

1. **Token storage key mismatch (now fixed):** `accept-invitation.html` was storing the session token in `localStorage` as `fp-session-token` (hyphen, localStorage), but `fp-backend.js` reads from `sessionStorage` as `fp_session_token` (underscore, sessionStorage). Fix: use `sessionStorage.setItem('fp_session_token', d.sessionToken)`.

2. **Missing cookie on invitation accept (now fixed):** `POST /team/invitations/accept` returned the `sessionToken` in JSON only — it never called `res.cookie()`. Without the cookie, browser navigations (refresh, new tab) fail auth since fp-backend.js has no Bearer token to send.  Fix: add `res.cookie("fp_token", sessionToken, { httpOnly, secure, sameSite, maxAge: SESSION_TTL_MS })` before `res.json()` in team.ts.

3. **Role fallback masked real bug:** `me.ts` had `req.orgContext?.role ?? "owner"` as the fallback. Any session missing a role would show as "owner", hiding the real issue. Fixed to `?? "member"`.

**Why:** The mismatch means invited members always had no usable token on the client side — the session relied on a cookie that was never set, so refreshing the page caused 401 → redirect to login, and the role showed as "owner" from the fallback.

**How to apply:** Any future auth endpoint that creates a session token and returns it in JSON must ALSO set the `fp_token` cookie. The `fp_session_token` key in sessionStorage is the canonical client-side store for Bearer auth in fp-backend.js.
