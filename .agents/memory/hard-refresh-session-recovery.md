---
name: Hard refresh session recovery
description: Why hard refresh caused a login redirect and how the two-layer fix works.
---

## The bug

Hard refresh → login redirect on every refresh.

**Root cause (double failure):**

1. **Client skipped session-restore when sessionStorage had a token.**  
   `_sessionReady` (fp-backend.js) and dashboard.js init both had `if (!token) call session-restore`.  
   If the token in sessionStorage was stale (re-login from another tab called `invalidateAllSessions`), the stale Bearer was sent to `/api/me` → 401 → redirect.

2. **Server `session-restore` used `Bearer || Cookie` short-circuit.**  
   If a stale Bearer was sent, the server only tried that Bearer. Even though the HttpOnly cookie was still valid (set at login, never cleared), the server returned 401 without trying the cookie.

## The fix

**Server (`auth.ts` `/auth/session-restore`):**  
Try Bearer first. If Bearer is stale AND cookie is different, fall back to cookie.  
Return `{ token: cookieToken }` — the client updates sessionStorage with the fresh token.

**Client (page-wide session coordinator):**  
One browser-wide restore owns `session-restore`; every protected request joins that
promise before it evaluates a 401. The dashboard must not perform a second
unconditional restore after joining the coordinator.  
Forward the existing sessionStorage token as Bearer so the server can validate it
in one round-trip. If the server returns a different (cookie-sourced) token,
update sessionStorage silently. If the server returns 401 (both invalid), clear
sessionStorage — `/api/me` will redirect to login.

**Why:**  
`sessionStorage` survives hard refresh but is per-tab. When a re-login from another tab invalidates the old session, the stale token stays in sessionStorage indefinitely. The only way to recover without requiring a new login is to fall back to the HttpOnly cookie on session-restore.

**How to apply:**  
- `session-restore` must ALWAYS attempt cookie fallback when Bearer fails.
- Never skip session-restore in bootstrap code just because sessionStorage is non-empty.
- Keep one shared restore promise per browser page; do not add a separate
  dashboard bootstrap. Forced restores are reserved for BFCache and confirmed
  background-401 revalidation.
