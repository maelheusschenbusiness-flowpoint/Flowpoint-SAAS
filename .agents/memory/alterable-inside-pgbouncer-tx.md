---
name: ALTER TABLE inside PgBouncer transaction
description: DDL inside a BEGIN block poisons the transaction on Supabase PgBouncer pooled connections, causing activation_failed errors.
---

## Rule
Never run `ALTER TABLE` (or any DDL) inside an explicit `BEGIN/COMMIT` block when the DB connection goes through PgBouncer in transaction pooling mode (Supabase default pooled port 6543).

## Why
PgBouncer in transaction mode may reject DDL statements or route them to a different backend connection. Even if the JS `.catch(() => {})` swallows the Promise rejection, PostgreSQL marks the transaction as aborted (`25P02: current transaction is aborted, commands ignored until end of transaction block`). All subsequent DML (`INSERT`, `UPDATE`, `SELECT`) inside that transaction silently fail, COMMIT becomes a no-op ROLLBACK, and no data is written.

This was the root cause of "Erreur de finalisation" in finalize-checkout: the ALTER TABLE self-heals for `users` columns were inside the `BEGIN` block, poisoning the `INSERT INTO users/organizations/organization_members` statements that followed.

## How to apply
Run schema self-heals (`ADD COLUMN IF NOT EXISTS`) in a **separate connection** in auto-commit mode, **before** the `BEGIN` that opens the activation transaction. Use a dedicated pool.connect() + finally release() block for DDL only:

```typescript
const selfHealC = await pool.connect();
try {
  await selfHealC.query(`ALTER TABLE t ADD COLUMN IF NOT EXISTS col TYPE`).catch(() => {});
  // more self-heals...
} finally { selfHealC.release(); }

const txC = await pool.connect();
try {
  await txC.query("BEGIN");
  await txC.query("INSERT INTO t ...");
  await txC.query("COMMIT");
} catch (e) {
  await txC.query("ROLLBACK").catch(() => {});
  throw e;
} finally { txC.release(); }
```

Also add `updated_at` to self-heal lists — it is referenced in `ON CONFLICT DO UPDATE SET updated_at=NOW()` but was missing from the original self-heal list in finalize-checkout.
