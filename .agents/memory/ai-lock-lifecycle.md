---
name: AI conversation lock permanent after Stop
description: Root cause and fix for the "réponse déjà en cours" lock that persisted after clicking Stop.
---

## The rule

The `_activeExecutions` Set in `ai.ts` must be cleaned up on BOTH `res.finish` AND `res.close`. Never listen only to `"finish"`. The cancel endpoint must also delete from `_activeExecutions` immediately (not just add to `_cancelledConversations`). The frontend `fpAiStop` must clear `STATE._aiConversationId` BEFORE calling the cancel endpoint.

**Why:** Three independent bugs combined to produce a permanent lock:
1. `res.on("finish", cleanup)` alone — when `AbortController.abort()` closes the TCP socket, Node fires `res.close` but `res.finish` only fires when `res.end()` is explicitly called and succeeds. If the server is still waiting on the LLM call when the client disconnects, `res.end()` may never be reached, so `_activeExecutions` keeps the conversationId forever.
2. The cancel endpoint (`POST /ai/conversations/:id/cancel`) only added to `_cancelledConversations` (60s marker) but never deleted from `_activeExecutions`. The duplicate-execution guard checked `_activeExecutions.has()` — still true — so the next request was always blocked with the "réponse déjà en cours" SSE error.
3. `fpAiStop` did NOT clear `STATE._aiConversationId`. The next `sendAIMessage` reused the old `convId` still in `_cancelledConversations` (60s TTL), causing the server's `isCancelled()` to return true immediately for the new message, which appeared as an instant abort.

**How to apply:**
- `_cleanupExecution` = `() => { _activeExecutions.delete(id); _executionStartTimes.delete(id); }` — register on BOTH `res.on("finish", ...)` AND `res.on("close", ...)`
- Cancel endpoint: `_activeExecutions.delete(conversationId); _executionStartTimes.delete(conversationId);` before the 60s TTL setTimeout
- Stale sweep: `setInterval(() => { for [id,ts] of _executionStartTimes: if ts < now - 5min → delete both }, 60s).unref()` — prevents permanent locks from crashes/OOM
- `fpAiStop` order: (1) abort AbortController, (2) `STATE._aiStreamCtrl = null`, (3) capture `convId = STATE._aiConversationId`, (4) `STATE._aiConversationId = null`, (5) `STATE.aiLoading = false`, (6) `updateAIUI()`, (7) fire-and-forget cancel fetch with old `convId`
- Test file: `src/routes/ai-lock-lifecycle.test.ts` — 8 scenarios, all pass

## Follow-up bug: stale cancel marker kills the NEXT generation

The 60 s `_cancelledConversations` TTL marker also short-circuited every NEW message sent in the same conversation within that minute: the tool loop's `isCancelled()` returned true immediately and the reply was just "⏹ Génération interrompue." (reproduced live: interruption → all subsequent tool-using messages in the conversation returned the marker).

**Fix:** when a new generation legitimately acquires the execution lock (`_activeExecutions.add`), delete the conversationId from `_cancelledConversations`. The in-flight request being cancelled is already covered by its own `_clientGone` close-listener, so clearing the set is safe. Regression test: T10 in `ai-lock-lifecycle.test.ts`.

**Test-harness notes:** `aiStream` is an async generator yielding `{ content }` chunks (mock with `async function* () { yield { content: "..." } }`, NOT an sseWrite callback); mock `ai-provider-matrix.js` partially via `importOriginal` (pure config module) instead of listing exports; warm `import("./ai.js")` in a `beforeAll` (30 s) or the first test importing it trips the 5 s timeout.
