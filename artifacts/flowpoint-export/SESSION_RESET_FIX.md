# Session Reset P0 Fix — Root Cause Report

## Root Cause

`dashboard.js` had a single global 401 handler inside `apiFetch()` (originally lines 424–429) that, **on any 401 response from any request**, immediately:
1. Cleared all localStorage auth keys
2. Called `sessionStorage.clear()`
3. Hard-redirected to `/login.html`

Three background polling loops all routed through `apiFetch()`:

| Loop | Interval | Endpoint |
|---|---|---|
| Audit status poll | 7 s | `/api/audits` |
| Activity / notifications | 60 s | `/api/activity`, `/api/notifications` |
| GA4 Live realtime | 30 s | `/api/live/realtime` |

If any of these polls received a **transient** 401 (network hiccup, rolling deploy, brief JWT clock drift, rate-limit), the global handler destroyed the session for the entire app and every open tab — even though the user's session was perfectly valid.

`fp-backend.js` had the identical flaw in its own 401 handler (lines 77–81).

**Secondary issue:** `loadData()` restored `fp-state-cache` into `STATE` before `/api/me` resolved. If the cache contained a stale user object and `/api/me` later returned 401, the flash of stale state combined with an immediate full redirect was jarring.

## Files Changed

| File | Change |
|---|---|
| `dashboard.js` | Added `_401BackgroundCount` / `_401ConfirmTimer` / `_confirmSessionExpired()` module-level; updated `apiFetch` 401 handler; added `backgroundPoll: true` to 3 poll call-sites; added `STATE._cacheRestored` flag in `loadData` |
| `fp-backend.js` | Added `_fp401BackgroundCount` / `_fp401ConfirmTimer` / `_confirmSessionExpiredBackend()`; updated `apiFetch` 401 handler with same pattern |

## Fix Applied

### 1. `backgroundPoll` option flag
Each of the three background polling call-sites now passes `{ backgroundPoll: true }`:
- `apiFetch('/api/audits', { force: true, backgroundPoll: true })`
- `apiFetch('/api/activity', { backgroundPoll: true })`
- `apiFetch('/api/notifications', { backgroundPoll: true })`
- `apiFetch('/api/live/realtime', { backgroundPoll: true })`

### 2. Debounced confirmation gate in `apiFetch`
When `opts.backgroundPoll` is set and a 401 is received:
- Increment `_401BackgroundCount`
- Log to `console.warn` with timestamp, endpoint, and count
- Schedule a single `_confirmSessionExpired()` call after **3 s** (only if no timer already running)
- Do NOT clear storage or redirect

`_confirmSessionExpired()` uses plain `fetch('/api/me', { credentials: 'include' })` (not `apiFetch`) to avoid recursion:
- If `/api/me` returns 401 → session is truly expired → clear storage + redirect
- Otherwise → log "session still valid" → reset counter

Any successful **foreground** request resets `_401BackgroundCount` to 0.

Foreground 401s (no `backgroundPoll` flag) still immediately clear + redirect — ensuring logout button, `disconnectAllSessions`, and real session expiry all behave correctly.

### 3. `STATE._cacheRestored` flag in `loadData`
After the `fp-state-cache` is read into `STATE`, `STATE._cacheRestored = true` is set. After `/api/me` resolves successfully, it is cleared and `_401BackgroundCount` is reset.

## Test Matrix

| Scenario | Expected behaviour | ✓ |
|---|---|---|
| Page refresh (valid session) | No redirect; cache restores instantly, live data loads | ✓ |
| Multiple tabs (same session) | Each tab's `/api/me` succeeds; no cross-tab interference | ✓ |
| Navigation back/forward | History pop triggers `loadData`; valid session survives | ✓ |
| Single transient 401 from background poll | Counter incremented; confirmation fetch finds session valid; no redirect | ✓ |
| Audit poll 401 → next tick succeeds | Counter reset; no redirect | ✓ |
| Rolling deploy (server briefly returns 401) | Same as transient 401 above | ✓ |
| True expired session (manual cookie deletion) | `/api/me` foreground returns 401 → immediate redirect | ✓ |
| True expired session via background poll | Confirmation `/api/me` also 401 → redirect after 3 s delay | ✓ |
| Logout button | POST `/api/auth/logout` is a foreground request (no `backgroundPoll`) → redirect as before | ✓ |
| `disconnectAllSessions` | Foreground call → 401 redirect as before | ✓ |

## Diagnostic Logging
All 401 events now log to `console.warn` with ISO timestamp, endpoint URL, background/foreground classification, and confirmation result. Example:
```
[FP-AUTH] 2026-07-31T12:34:56.789Z Background poll 401 on /api/audits — count: 1 — scheduling confirmation fetch in 3s.
[FP-AUTH] 2026-07-31T12:34:59.800Z Confirmation /api/me → 200 — session still valid, ignoring background 401.
```
These logs can be removed after two stable deploy cycles.
