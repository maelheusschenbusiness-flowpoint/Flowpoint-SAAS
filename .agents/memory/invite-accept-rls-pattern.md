---
name: Invite accept — RLS GUC for FORCE ROW LEVEL SECURITY tables
description: How to satisfy FORCE ROW LEVEL SECURITY policies in a raw pool.connect() transaction without risking an aborted-transaction state
---

## Rule

For tables with `FORCE ROW LEVEL SECURITY` (like `organization_members`), policies apply to **all** users including superusers and BYPASSRLS connections. Setting the GUC alone satisfies the policy — no role change is needed or safe to attempt in a long-running raw-client transaction.

**Correct pattern inside a raw pool.connect() transaction:**

```typescript
// Parameterized set_config — transaction-local (third arg true), no string interpolation
await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
// Then DML that FORCE RLS policies will evaluate against this GUC
await client.query(`INSERT INTO organization_members ...`, [...]);
```

**Why not `SET LOCAL ROLE app_user`:**  
On Supabase, `SET LOCAL ROLE app_user` throws when the connection user doesn't have the role granted. A throw mid-transaction marks the transaction ABORTED — every subsequent query including the catch-block recovery fails with "current transaction is aborted". The `withOrgDb` shared helper avoids this via a module-level `_appUserRoleUnavailable` flag that skips the role attempt after the first failure, doing ROLLBACK + BEGIN in the first-time catch. Replicating this pattern in a mid-transaction context is unsafe; the correct fix is to omit the role change entirely for FORCE-RLS tables where the GUC alone is sufficient.

**Why FORCE RLS makes GUC-only safe:**  
Regular RLS (`ENABLE ROW LEVEL SECURITY` without FORCE) is bypassed by BYPASSRLS users. FORCE RLS overrides BYPASSRLS — policies run for everyone. So a superuser connection with only the GUC set will still have its DML evaluated against the policy predicate `organization_id = current_setting('app.current_org_id', true)`.

**How to apply:**  
Any raw-client transaction writing to `organization_members` or other FORCE-RLS tenant tables: call `set_config('app.current_org_id', orgId, true)` with a parameterized query before the DML. Routes using `req.orgDb()` or `withOrgDb()` already handle this automatically.
