---
name: apiFetch auth state machine — secondary endpoint 401 must not cause global logout
description: Structural rule preventing false logouts when plan-gated or org-isolated endpoints return 401 while the session is valid.
---

## The rule

In `dashboard.js` `apiFetch`, the foreground-401 redirect to `/login.html` must ONLY fire when the **session-critical** `/api/me` endpoint itself fails persistently.

**Why:** Secondary endpoints (billing, monitors, notifications, AI, etc.) can return 401 for reasons unrelated to the session — plan gate, org isolation, feature flag. If any of them returns 401 after the cookie-recovery retry, the previous code would globally log the user out even though `/api/me` was valid. This was the root cause of the "F5 → Sign In" false logout.

**How to apply:**

```javascript
// In the foreground-401 handler, after recovery fails:
const _isSessionCritical = path === '/api/me' || path.startsWith('/api/auth/');
if (!_isSessionCritical) {
  // Throw a local error — let the individual caller decide what to show.
  const _err401 = new Error('Unauthorized');
  _err401.status = 401;
  throw _err401;
}
// Only for /api/me: clear auth + redirect.
window.location.replace('/login.html');
```

**Recovery call must send Bearer:**  
The session-restore call inside the foreground-401 recovery should include the existing sessionStorage Bearer (mirrors Phase 0.5 in `loadData()`):

```javascript
const _recToken = _fpCurrentSessionToken();
const _recHeaders = { 'Content-Type': 'application/json' };
if (_recToken) _recHeaders['Authorization'] = 'Bearer ' + _recToken;
const _rec = await fetch('/api/auth/session-restore', {
  method: 'POST', credentials: 'include', headers: _recHeaders,
});
```

**Background 401s** (polling, SSE ticks) already go through a separate `_confirmSessionExpired()` path that checks `/api/me` before acting. The structural fix above only affects foreground (non-`backgroundPoll`) 401s.
