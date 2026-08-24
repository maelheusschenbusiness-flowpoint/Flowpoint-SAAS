---
name: withOrgDb role degradation and locked-session reuse
description: Safe RLS context under managed Postgres and while a caller owns a session-level advisory lock
updated: 2026-08-24
---

**Rule:** Call `probeAppUserRole()` at server startup (before any request). This tests `SET ROLE app_user` at session level (no transaction) — failure is a normal exception, not a transaction abort. The `_appUserRoleUnavailable` flag is set before the first request arrives.

**Why:** Supabase / Render managed DBs — the `DATABASE_URL` connection user (e.g. `postgres`) typically doesn't have `app_user` granted. The original fix wrapped `SET LOCAL ROLE app_user` in try/catch inside a `BEGIN` transaction. But in PostgreSQL, ANY failing command inside a transaction puts it in "aborted" state — the catch rescues Node.js but the transaction is still dead. Subsequent `SET LOCAL "app.current_org_id"` and all query callbacks then fail with "current transaction is aborted", causing 500s on every RLS-scoped endpoint.

**How to apply:**
1. `probeAppUserRole()` is exported from `lib/db/src/index.ts`. Call it at startup in `artifacts/api-server/src/index.ts` right after `pool.query("SELECT 1")`, wrapped in try/catch (non-fatal).
2. In `withOrgDb()`, check `_appUserRoleUnavailable` BEFORE `BEGIN`. If true, skip the SET ROLE entirely.
3. Defensive fallback in `withOrgDb()`: if SET ROLE somehow fails inside a transaction (edge case), do `ROLLBACK` + fresh `BEGIN` before continuing — never leave an aborted transaction open.
4. Tenant isolation still holds via `SET LOCAL "app.current_org_id"` GUC — all RLS policies check `current_setting('app.current_org_id', true)`.

**To restore full role isolation on prod:** `GRANT app_user TO <db-connection-user>;` in Supabase SQL editor.

## Session-level advisory locks

**Rule:** While holding a session-level advisory lock on a pooled client, every tenant-scoped operation in that critical section must reuse that same client through `withOrgDbClient()`. Do not call `withOrgDb()` or any helper that acquires another connection.

**Why:** If N concurrent waiters occupy all N pool connections while waiting on the same advisory lock, the lock owner deadlocks when it asks the exhausted pool for an additional RLS-scoped connection. Reusing the owner’s session guarantees progress while preserving the tenant GUC and role behavior.

**How to apply:** Complete module/quota/model preflight before acquiring the lock. Inside the lock, pass the existing client transitively into rate-limit, usage-accounting, cache, and recovery helpers; ensure none silently call `pool.connect()`.
