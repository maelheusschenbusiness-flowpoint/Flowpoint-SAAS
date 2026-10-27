---
name: Test execution context
description: Inherited production mode and live-server discovery can change test outcomes independently of dependency changes.
---

Run the API tests with explicit `NODE_ENV=test`; do not assume Vitest overrides an inherited production setting.

**Why:** The workspace shell can inherit production mode. Authentication and unsigned-webhook guards then correctly reject test harness requests, making otherwise passing mocked tests fail.

**How to apply:** Set test mode on the test command, not on the application workflow. Also distinguish self-contained tests from tests that discover a running API: the latter depend on that server's tenant and billing state, not just the code under test.

For one Vitest file, invoke it directly with `pnpm --filter @workspace/api-server exec vitest run <path>`. Appending the path to this package's `test --` script invocation ran the full suite instead.

**Why:** The attempted single-file command timed out after starting all API tests, obscuring the targeted result.

**How to apply:** Use the direct `exec vitest run` form for focused checks; reserve the package `test` script for the full suite.
