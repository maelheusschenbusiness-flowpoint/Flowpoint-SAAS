---
name: Service mutations must enforce orgId in SQL, not just accept it
description: Cross-tenant authorization rule for role/SSO/session (and any id-addressed) service mutations; accepting-and-discarding orgId is a blocking security regression.
---

# Rule

Any service function that takes `(orgId, id, ...)` MUST put `AND org_id=$orgId` in every UPDATE/DELETE/SELECT it runs, check `rowCount === 0` → throw 404 (`Object.assign(new Error(...), { statusCode: 404 })`), and routes must map `err.statusCode` instead of blanket 500. An overload that resolves the orgId argument and then ignores it is worse than not accepting it — it looks scoped but isn't.

**Why:** permissions-service/sso-service mutations (updateRole, deleteRole, assignRole, updateSSOProvider, deleteSSOProvider, invalidateSession) accepted orgId but filtered only by record id; these run on the superuser `pool` (no RLS), so any authenticated admin could mutate another tenant's roles/SSO config/sessions by guessing ids. Caught by completion code review as a blocking regression.

**How to apply:**
- assignRole must also verify the roleId belongs to the caller's org (system role ids exempt) AND scope the member-row update by org_id.
- invalidateSession must delete `WHERE token=$1 AND org_id=$2`.
- Cross-tenant integration tests live at `src/tests/cross_tenant_rbac_sso.test.ts` (org A vs org B, negative + positive controls); vitest.config.ts has an explicit `include` list — new test files must be added there or they silently never run.
- DB-backed test files must un-mock the pool: `vi.mock("@workspace/db", async (io) => io())` because vitest.setup.ts globally stubs it.
