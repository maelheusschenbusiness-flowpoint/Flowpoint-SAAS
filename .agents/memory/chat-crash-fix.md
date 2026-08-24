---
name: AI chat crash fix — ERR_STREAM_WRITE_AFTER_END + unhandledRejection
description: Root cause and fix for the server crashing after every AI chat SSE response
---

## Root causes (two distinct bugs)

**Bug 1 — ERR_STREAM_WRITE_AFTER_END (primary crash)**
- `runToolCallingLoop` receives `sseClose` callback that writes `data: [DONE]\n\n` and calls `res.end()`
- After the loop returns with `loopResult.suspended || loopResult.finalTextEmitted`, the outer `chatHandler` block at lines 2561-2568 in `ai.ts` ALSO tried to write `_ai` frame + `[DONE]` + call `res.end()` on the already-ended response
- This throws `Error: ERR_STREAM_WRITE_AFTER_END` as an uncaughtException
- **Fix**: wrap the entire outer write block in `if (!res.writableEnded) { ... }`

**Bug 2 — No global exception handlers (secondary)**
- No `unhandledRejection` / `uncaughtException` process handlers → Node 20 exits on ANY unhandled rejection
- **Fix**: added both handlers in `index.ts` before `main()` call — log the rejection loudly but keep the process alive

## Why it manifested post-[DONE]
The SSE stream finishes, pino logs the request, then the Node.js process tick queue flushes the uncaughtException → process.exit(). Appeared as curl exit code 7 (connection refused) on the NEXT request.

## Commits pushed
- `58193e59` — global unhandledRejection + uncaughtException handlers in index.ts
- `d25dc6e4` — writableEnded guard in chatHandler (ai.ts lines 2561-2573)

**How to apply:** Any future SSE route that has a `sseClose()` callback + outer write block must guard all writes with `if (!res.writableEnded)`.
