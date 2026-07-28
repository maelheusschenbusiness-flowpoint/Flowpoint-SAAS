---
name: Magic link 503 loop — root cause & fix
description: Why login-verify returned persistent 503, and the architectural fix applied.
---

## Root Cause
Dynamic `await import("../services/org-settings.js")` calls INSIDE the 6-check `try` block.
In the production esbuild bundle (single-file `dist/index.mjs`), these dynamic relative-path imports
can throw at runtime → `catch(guardErr)` fires → token restored → 503 returned → infinite loop.

Also: `await import("@workspace/db")` inside the try block — redundant, same pool already imported statically at top.

## Fix Applied
1. **Static import** of `loadOrgSettings` added at top of auth.ts — eliminates both dynamic imports in 6-check.
2. **`pool` used directly** (top-level import) — `await import("@workspace/db")` removed from 6-check.
3. **Peek-before-consume architecture**:
   - `peekToken()` — SELECT only (no UPDATE), validates token without consuming
   - `finalConsumeToken()` — UPDATE SET used=true called only AFTER all 6 checks pass
   - On any check failure (logical OR exception) → token NOT consumed → user can retry
   - On concurrent race → `finalConsumeToken()` returns `{ consumed: false }` → 410

## Proof Results
- Valid user (users+org+membership) → 200, token consumed ✅
- Expired/used/not_found → 401/410/401 ✅  
- Active user with no org membership → 403, token NOT consumed → retry works ✅
- Retry after 403 → 403 (not 410) — no boucle 503 ✅

**Why:** In esbuild single-file bundles, dynamic imports of relative paths that are NOT statically imported elsewhere
may resolve differently than expected at runtime. Static imports are always safe.

**How to apply:** Any `await import("../services/foo.js")` inside a try/catch that also has error recovery
logic must be converted to a static import at file top to be safe in production bundles.
