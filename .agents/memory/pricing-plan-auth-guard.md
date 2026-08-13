---
name: Pricing page current-plan anti-flash guard
description: The pricing page anti-flash mechanism must check for an active session before marking the current plan
---

## Rule

The pricing page reads `fp_dashboard_state` from localStorage to immediately mark the current plan (anti-flash UX). This runs BEFORE any API call completes. Without a session check, unauthenticated visitors who have stale localStorage from a previous login would see "✓ Votre plan actuel" on the plan they last subscribed to.

**Fix applied:** Before reading `fp_dashboard_state`, check:
```js
var _hasActiveSession = !!(
  sessionStorage.getItem('fp_session_token') ||
  localStorage.getItem('fp-session-token')
);
var _ds = _hasActiveSession ? JSON.parse(localStorage.getItem('fp_dashboard_state') || 'null') : null;
```

**Why:** The anti-flash reads localStorage (persists across sessions) but auth is sessionStorage-based (cleared on tab close). When the cookie expires or user logs out without clearing localStorage, the anti-flash wrongly marks a plan.

**How to apply:** Any page that reads billing/plan state from localStorage for anti-flash display must gate on `_hasActiveSession`. The `fp-session-token` (hyphen, localStorage) key is written by the invitation accept flow; `fp_session_token` (underscore, sessionStorage) by normal login.
