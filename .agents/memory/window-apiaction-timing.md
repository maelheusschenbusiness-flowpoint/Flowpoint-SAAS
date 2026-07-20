---
name: window.apiAction timing fix
description: apiAction must be on window at module level, not only inside the async IIFE
---

## Rule
`window.apiAction = apiAction` must be assigned at module level alongside `window.STATE`, NOT only inside the async initialization IIFE.

## Why
dashboard.js's main IIFE is `async` and makes API calls (awaits) before reaching the `window.apiAction = apiAction` assignment at line ~14848. When an onclick attribute fires, it evaluates in global (window) scope. If the IIFE hasn't reached line 14848 yet, `apiAction` is undefined → `apiAction is not defined` error.

`window.showToast` works because it is assigned BOTH inside the IIFE (early) AND at module level (line 28628). `apiAction` was only inside the IIFE.

## Fix applied
Added `window.apiAction = apiAction;` at the module-level EXPOSE GLOBALS block (line 28633), next to `window.STATE = STATE` and `window.showToast = showToast`. Since `apiAction` is declared as a module-level `async function` (line 445), it is in scope there.

## How to apply
Any function used in inline `onclick` attributes must be exposed on window at module level, not just inside the IIFE. Check when in doubt: `typeof myFn` in browser evaluate — if undefined after page load, add `window.myFn = myFn` to the module-level EXPOSE GLOBALS block.
