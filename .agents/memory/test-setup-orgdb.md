---
name: Test setup — orgDb + dbContext
description: Test servers that exercise routes using req.orgDb must include both orgContext AND dbContext middlewares, in that order.
---

## Rule
Any integration test server that mounts routes from `me.ts`, `security.ts`, or any other route file that calls `orgDb(req)` (i.e. `(req as OrgReq).orgDb`) must include **both** middlewares:

```typescript
app.use(orgContext);   // sets req.orgId, req.orgContext
app.use(dbContext);    // sets req.orgDb ← required for all orgDb(req) calls
```

**Why:** `orgContext` only sets identity fields. `req.orgDb` is attached separately by `dbContext` (`src/middlewares/dbContext.ts`). Without `dbContext`, `req.orgDb` is `undefined` and the call throws, causing a silent `{ ok: false }` response from the catch block.

## How to apply
- Before mounting any route file that uses `orgDb(req)` in a test server, add `dbContext` after `orgContext`.
- Routes that use `pool.query()` directly (e.g. billing.ts uses `withOrgDb` internally) do not need `dbContext` in the test.
- Import: `import { dbContext } from "../../src/middlewares/dbContext.js";`
