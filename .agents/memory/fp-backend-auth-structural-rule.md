---
name: fp-backend.js apiFetchNow — session-critical rule
description: The foreground-401 redirect rule must be applied in BOTH dashboard.js AND fp-backend.js. Missing it in fp-backend was the root cause of F5→SignIn.
---

## The rule

`apiFetchNow` in `fp-backend.js` must apply the SAME session-critical check as `dashboard.js apiFetch`:

```javascript
var _isCrit = path === '/api/me' || path.startsWith('/api/auth/');
if (!_isCrit) {
  var _err = new Error('Unauthorized'); _err.status = 401; throw _err;
}
_clearAuth();
window.location.replace('/login.html');
```

This rule must be applied at ALL three redirect paths in `apiFetchNow`:
1. After retry following successful session-restore (post-session-restore 401)
2. When session-restore response is non-OK
3. When session-restore throws a network error

**Why:** fp-backend.js and dashboard.js are loaded as separate IIFEs on the same page. They each have their own `apiFetch` implementation. When fp-backend.js's `apiFetchNow` lacked this rule, secondary endpoints returning 401 for plan-gate or feature-flag reasons would trigger a global logout — destroying a valid session.

**The AI widget raw fetch** at line ~2544 in fp-backend.js had the same problem:
- Old: immediate `window.location.replace('/login.html')` on 401 from `/api/ai/chat`
- Fix: increment `_fp401BackgroundCount` and schedule `_confirmSessionExpiredBackend()` — same pattern as background polls

**How to apply:** Any time a new API call is added to fp-backend.js using raw `fetch` or `apiFetchNow`, ensure the 401 handler either:
a) Routes through the existing `apiFetch` wrapper (preferred — inherits the rule automatically), or
b) Applies the same `_isSessionCritical` check inline.
