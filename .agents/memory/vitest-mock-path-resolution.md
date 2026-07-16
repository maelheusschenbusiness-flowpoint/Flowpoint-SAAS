---
name: vitest mock path resolution in setupFiles
description: vi.mock("./module.js") in a setupFile resolves relative to the setupFile, not the test file importing the module
---

## Rule
`vi.mock("./ai-engine.js")` in `src/vitest.setup.ts` registers a mock for `src/ai-engine.js`.
But `ai-economy.ts` (in `src/services/`) imports `"./ai-engine.js"` → resolved to `src/services/ai-engine.ts`.
These are **different module IDs** → the mock does NOT intercept the import.

## Consequence
`getOrgUsageStatus()` calls `getOrCreateMonthlyUsage()` from `src/services/ai-engine.ts`. Even though the setup mocks `"./ai-engine.js"`, the real function runs in unit tests, causing failures when `withOrgDb` is not in the `@workspace/db` mock.

## Fix patterns
1. **Pure formula tests** — test the math directly without calling the DB-backed function at all (preferred for unit tests)
2. **HTTP integration tests** — call the real server endpoint; real DB is hit but that's expected
3. **Static import for mock coverage** — only the static import in the test file (module-level) reliably gets the mocked module. Dynamic `await import("./module.js")` inside a test body may get a different module instance.

**Why:** vitest's `vi.mock` is hoisted and resolves paths relative to the file where it appears (setupFile or test file). The mock registry uses absolute resolved paths. If the setupFile and the source module are in different directories, the relative paths won't match.

**How to apply:** When adding unit tests for functions that call DB through a path not covered by the mock, either (a) test the pure formula logic only or (b) add the mock in the TEST file with the correct relative path.
