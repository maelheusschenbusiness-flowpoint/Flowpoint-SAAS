---
name: pdf-parse sub-path import
description: Why pdf-parse/lib/pdf-parse.js must be used instead of pdf-parse; how to mock it in tests.
---

## Rule
Import `pdf-parse/lib/pdf-parse.js` (not `pdf-parse`) in pdf-parser.ts.

**Why:** `pdf-parse/index.js` calls `readFileSync('./test/data/05-versions-space.pdf')` at module load time. That path is relative to `process.cwd()`, which is NOT the package directory in production → ENOENT → the dynamic `import()` throws → 503 before the request handler runs.

**How to apply:**
- In `pdf-parser.ts`: `const mod = await import("pdf-parse/lib/pdf-parse.js")`. Add `// @ts-ignore` since the sub-path has no type declarations in v1.1.1.
- ESM import shape is `{ default: fn }` (keys: `['default']`). Check `typeof mod.default === "function"`.
- In tests: mock target must be `"pdf-parse/lib/pdf-parse.js"` (both `vi.mock` and `vi.doMock`), not `"pdf-parse"`. The `loaded.push(...)` tracking string can remain `"pdf-parse"` for readability.
- esbuild external rule `"pdf-parse"` covers sub-paths — no build.mjs change needed.
