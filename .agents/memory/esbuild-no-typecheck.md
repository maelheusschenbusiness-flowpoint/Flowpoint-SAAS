---
name: esbuild builds do not typecheck
description: Why a green build can still ship a runtime ReferenceError, and the check that catches it
---

The api-server build runs esbuild, which strips types without checking them.
A green `pnpm run build` therefore proves nothing about type correctness.

The dangerous case is a **free identifier**: code referencing a symbol that was
never imported. esbuild bundles it untouched and the module throws
`ReferenceError` at runtime, only on the code path that touches it — so it can
sit in production behind a rarely-hit branch. A real instance: an add-on price
lookup was refactored to read from the canonical definitions map, but the import
was never added; the bundle built cleanly and the payment-amount computation
would have thrown for any checkout containing an add-on.

**How to apply:** after editing api-server sources, run
`pnpm exec tsc --noEmit -p tsconfig.json` and grep the output for the files you
touched. The repo has a large backlog of pre-existing errors (missing `pg`
types, zod/pino-http signature mismatches), so a clean overall run is not
achievable — filtering to your own files is the usable signal. Treat
`TS2304: Cannot find name 'X'` as a release blocker, not a type nit.
