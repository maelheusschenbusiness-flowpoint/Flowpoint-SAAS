---
name: Audits concurrency PgBouncer fix
description: pg_advisory_lock (session-level) is broken with Supabase PgBouncer; must use pg_advisory_xact_lock + BEGIN/COMMIT; launchAudit supports preInsertedId to skip double INSERT
---

## Rule
`pg_advisory_lock` (session-level) does NOT work with Supabase PgBouncer transaction pooling.
Consecutive queries on the same `PoolClient` can be routed to different backend PostgreSQL sessions.

## Fix
Use `pg_advisory_xact_lock` (transaction-level) inside `BEGIN...COMMIT`.
All quota-checked INSERTs must happen on the SAME connection, within the SAME transaction.

## Pattern for audits (audits.ts)
1. `_auLockClient = pool.connect()`
2. `BEGIN`
3. `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)` — B blocks here until A commits
4. `checkQuota(...)` — reads current count (separate connection, fine)
5. If quota exceeded → `ROLLBACK` → 402
6. `INSERT INTO audits (...)` — on `_auLockClient`, within the transaction
7. `COMMIT` — lock released, INSERT visible to subsequent requests
8. `launchAudit({ ..., preInsertedId })` — triggers PSI + notifications, skips the INSERT

## launchAudit preInsertedId
`audit-runner.ts` `launchAudit()` accepts optional `preInsertedId`.
When set, the INSERT is skipped (row already committed by caller).
All other effects (logActivity, PSI, SSE broadcast, usage events) still run.

**Why:** Without preInsertedId, launchAudit would INSERT again → duplicate row.

## Verified
61/61 boundary + concurrency tests pass on production Render (SHA fde24de920).
