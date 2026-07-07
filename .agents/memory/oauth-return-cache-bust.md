---
name: OAuth return cache-bust pattern
description: How to ensure the FlowPoint dashboard reflects Google/GitHub connection status immediately after OAuth redirect returns
---

## The rule

After an OAuth redirect, the dashboard must bust its sessionStorage cache so that status API calls re-fire and show the new "connecté" state.

**Why:** `loadData()` reads `fp-state-cache` (5-min stale-while-revalidate) before hitting the API. If the user does OAuth in a tab that already has a warm cache, the cache is restored first and the new token is never reflected — the UI keeps showing "Non connecté".

## How to apply (dashboard.js init())

At the top of `init()`, before `await loadData()`:

```js
try {
  const _href = window.location.href;
  if (_href.includes('google_connected') || _href.includes('github_connected') ||
      _href.includes('google_error')     || _href.includes('github_error')) {
    sessionStorage.removeItem('fp-state-cache');
    window.history.replaceState({}, '', window.location.pathname);
  }
} catch(_) {}
```

Note: GitHub callback uses hash-based params (`#integrations?github_connected=1`), so `window.location.search` won't see them — check `window.location.href` instead.

## GA4 / GSC status endpoints

`isGA4Connected()` checks `ga4_properties` and `getGSCStatus()` checks `gsc_sites`. Both tables are populated by background discovery jobs that run **after** the OAuth tokens are saved and the redirect fires. So immediately after OAuth return, the status endpoints would still return `connected: false`.

**Fix (routes/ga4.ts, routes/gsc.ts):** After the primary table check, call `hasGoogleConnection(orgId)` (exported from `google-service.ts`) to check `google_tokens`. If tokens exist, return `connected: true, discovering: true` even if the property/site table is still empty.

`hasGoogleConnection()` is the fast token-only check — it resolves true as soon as `saveTokens()` completes (synchronous before the redirect).
