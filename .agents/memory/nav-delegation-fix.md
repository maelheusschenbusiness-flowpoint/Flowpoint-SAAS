---
name: Nav item click delegation — global scope fix
description: Root cause and fix for SPA navigation broken + infinite skeleton regressions
---

## Rule
Sidebar nav item click handlers MUST be registered as document-level delegation at IIFE global scope, NOT as per-element `.addEventListener` inside `bindGlobalEvents()` (which runs inside `init()` after `await loadData()`).

## Why
`bindGlobalEvents()` is called after `await loadData()` in `init()`. During the 2-5 second load window, any click on a nav item has no handler:
- Click silently ignored
- Page stays on current route (overview)  
- `loadData()` then calls `render()` which re-renders the current route (NOT the one clicked)
- User sees "nothing happened" or a skeleton that never clears

The skeleton regression was the same root cause: user clicks Billing/Competitor/Settings during load → ignored → `render()` re-renders overview → skeletons shown for those routes on next manual visit while STATE.loading is transiently true.

## How to apply
The fix (applied 2026-07-28) at IIFE global scope in dashboard.js (near the other global delegations around line 30840):
```javascript
document.addEventListener('click', function _navDelegation(e) {
  var navEl = e.target && e.target.closest && e.target.closest('.fp-nav-item, .fp-nav-ai');
  if (!navEl || !navEl.dataset || !navEl.dataset.route) return;
  navigate(navEl.dataset.route);
  if (window.innerWidth <= 768) { /* mobile sidebar close */ }
});
```

The OLD per-element binding inside `bindGlobalEvents()` was replaced with a comment.

Any future nav-like element (mobile nav, breadcrumb nav links) that must work during load should follow the same pattern.

**Validated:** 11/11 nav tests + 7/7 skeleton tests pass after fix.
