---
name: Per-tab session bootstrap
description: Dashboard auth must bootstrap the sessionStorage token before any integration preload
---

The dashboard's HttpOnly cookie is shared across tabs, so every protected browser request must prefer the tab's `sessionStorage` Bearer token and omit credentials when that token is absent. Because `fp-backend.js` loads before `dashboard.js`, its integration timers must await the same session-restore bootstrap before making protected calls.

**Why:** Without this ordering, an early preload can authenticate as the last account that logged in or receive a 401 before the tab token is restored, causing multiple dashboards to converge on one account or redirect unexpectedly.

**How to apply:** Keep the per-tab token in `sessionStorage.fp_session_token`, make backend wrappers wait for session restore, and version dashboard assets whenever auth bootstrap changes so stale cached scripts cannot reintroduce the shared-cookie fallback.