---
name: dashboard.js skeleton stuck — SyntaxError
description: Root cause of the dashboard never loading (permanent skeleton): SyntaxError in the IIFE crashes all JS execution before init() runs. fp-backend.js shows the skeleton, dashboard.js never replaces it.
---

# dashboard.js skeleton stuck — SyntaxError

## Rule
Any SyntaxError in dashboard.js crashes the entire IIFE. fp-backend.js has already injected the loading skeleton, so the page appears stuck forever with no console output from dashboard.js itself.

**Why:** The IIFE wraps the entire codebase. A parse error = nothing executes = init() never called = skeleton stays.

**How to apply:** After EVERY edit to dashboard.js, run `node --check artifacts/flowpoint-export/dashboard.js` before committing. Don't assume a small edit is safe.

## Known bug fixed (2026-08-01)

### 1. Webhook spread expression — missing `)` (~line 28551 in 36832-line build)

```js
// BROKEN — 2 closing parens, but 3 needed
...((()=>{ return ...; })() || (STATE.settings... : (PREVIEW_MODE ? [...] : [...])))  ← )),
// FIXED
                                                                                       ← ))),
```

Structure: `...(( IIFE() || (fallback: (PREVIEW_MODE...)) ))` — three `)` needed after the false array:
1. Close `(PREVIEW_MODE ? [...] : [...])`
2. Close `|| (fallback)`
3. Close outer `(( ... ))`

### 2. French apostrophe in single-quoted JS string (~line 32461)

```js
// BROKEN
t.includes('plan d'action')   // apostrophe ends the string prematurely
// FIXED  
t.includes("plan d'action")   // use double quotes for French strings
```

## Prevention
- `node --check` after every edit — catches both issues instantly
- French strings with apostrophes (`d'`, `l'`, `n'`) must use double quotes or `\'` escaping
- Spread expressions `...((IIFE() || FALLBACK))` need paren count verification: open parens must match close parens

## TDZ variant (2026-08-04)
`typeof STATE` still throws a ReferenceError when `const STATE` is later in the SAME IIFE scope (temporal dead zone) — the `typeof x !== 'undefined'` guard only protects against *undeclared* globals, not TDZ. Any top-level code that runs before line ~89 (`const STATE = {`) must never mention STATE at all (not even under typeof); read localStorage instead. Symptom: whole IIFE dies, skeleton frozen on every page with `Cannot access 'STATE' before initialization`.
