---
name: dashboard.js apiFetch resilience
description: Three defenses against permanent skeleton state due to network/session failures added 2026-08-01.
---

# dashboard.js apiFetch resilience

## Changes made (2026-08-01)

### 1. AbortController timeout in apiFetch (15s)
Prevents TCP-hung fetches (e.g. server restart mid-request) from blocking loadData() forever.

```js
const _fetchTimeout = opts.timeout || 15000;
const _ctrl = new AbortController();
const _abortTimer = setTimeout(() => _ctrl.abort(), _fetchTimeout);
try {
  res = await fetch(_path, { ...opts, signal: _ctrl.signal, ... });
} finally {
  clearTimeout(_abortTimer);
}
```

### 2. Safety timer in loadData() (12s)
Forces STATE.loading = false + render() if loadData() hangs for any reason.
Clear it with clearTimeout(_loadSafetyTimer) at every early return and at Phase 3 render.

### 3. fp_session_token cleared on foreground 401
Previous code kept the stale per-tab Bearer token on 401, causing a redirect-loop where:
- stale token → 401 → redirect to login → cookie still valid → back to dashboard → stale token → ...
- Dashboard appeared stuck on skeleton (login redirect fast, back before the fatal error rendered)

Fix: both the foreground 401 handler and _confirmSessionExpired() now call:
`sessionStorage.removeItem('fp_session_token')` before `window.location.href = '/login.html'`

**Why:** sessionStorage is tab-isolated; removing fp_session_token here does NOT affect sibling tabs.
The old comment "keep fp_session_token so login page overwrites it" was misleading — the issue was the redirect loop, not identity preservation.
