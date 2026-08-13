---
name: AI Engine Robustness — Round 5
description: Timeouts, cancellation, mutex, audit await, stop button — fixes for AI chat reliability
---

## Rules

### PSI await pattern (run_audit / rerun_audit)
- **Rule:** `run_audit` and `rerun_audit` MUST await PSI inline (not fire-and-forget). Use `Promise.race([psiWork, timeout(58_000)])`. Send SSE keepalive every 5s via `ctx.sseWrite(": keepalive\n\n")` inside a `setInterval` that is `clearInterval`'d in a `finally` block.
- **Why:** Fire-and-forget returns `{status:"processing"}`, LLM loops through MAX_TOOL_ROUNDS with no result, falls off the end with no reply.
- **How to apply:** After PSI resolves, re-read the DB row to get the final score/status, then return the actual score in `content`. On timeout (>58s), return a "still processing" message with the auditId.

### Duplicate audit check
- **Rule:** Duplicate 24h check must return `ok:true` with the existing audit's score/status (not `ok:false`). If existing is still `processing`, poll via `_awaitAuditCompletion` helper.
- **Why:** `ok:false` confuses the LLM into looping and retrying indefinitely.

### Loop/round/tool timeouts
- `ROUND_TIMEOUT_MS = 35_000` — wraps each `aiChatWithTools` call via `Promise.race`.
- `TOOL_TIMEOUT_MS = 95_000` — wraps each `executeTool` call (≥ PSI 58s). Returns typed error object on timeout.
- `LOOP_DEADLINE_MS = 180_000` — hard cap checked at top of each round; emits SSE timeout message and returns.
- All emit SSE text so the bubble is never empty.

### Cancellation (server-side)
- `_cancelledConversations = new Set<string>()` in ai.ts — cleared by cancel endpoint, auto-expires after 60s.
- `POST /api/ai/conversations/:id/cancel` → adds to Set, returns `{ok:true}`.
- `isCancelled` checked at top of every round; emits "⏹ Génération interrompue." and returns.

### Mutex (double execution guard)
- `_activeExecutions = new Set<string>()` — added on SSE start, cleaned via `res.on('finish', ...)`.
- If `has(conversationId)` → emit 409-like SSE error message immediately, `res.end()`.
- `res.on('finish', ...)` is safer than try/finally when many early return paths exist.

### sseWrite / isCancelled in ExecuteContext
- Both `sseWrite` and `isCancelled` are in `ExecuteContext` interface (tool-executor.ts).
- Must be passed from chatHandler's `toolCtx` object; use `_safeWrite = (d) => !res.writableEnded && res.write(d)`.

### Stop button (frontend)
- `window.fpAiStop()` — POSTs `/api/ai/conversations/:id/cancel` then calls `STATE._aiStreamCtrl.abort('user_stop')`.
- `STATE._aiStopRequested = true` set before abort; cleared in catch block.
- AbortError with `_aiStopRequested` → "⏹ Génération interrompue." (not "délai dépassé").
- Stop button (`#ai-stop`, `#ai-panel-stop`) toggled in `updateAIUI` via `display: STATE.aiLoading ? 'inline-flex' : 'none'`.

### `window.loadMissions`
- Must be defined at IIFE global scope (near `updateAIUI`), NOT inside a conditional block.
- Fetches `/api/missions`, updates `STATE.missions`, calls `render()` if on missions page.
