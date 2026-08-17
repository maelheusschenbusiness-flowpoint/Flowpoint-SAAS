---
name: AI engine validation — Task #592
description: Real-world validation findings from the 9 CR-fix overhaul; critical behavioral discoveries about streaming vs non-streaming, tool calling, and context timing.
---

# AI engine validation — Task #592

## Key Discovery: Tool calling is SSE-only

`stream: false` calls `aiChat()` — a single-shot LLM call with NO tool loop.
`stream: true` calls `runToolCallingLoop()` (ai.ts:1042) which actually dispatches tools.

**Why:** Tests run with `stream: false` will NEVER see tool calls (create_mission, list_missions, etc.).
Any behavior test for tool invocation MUST use `stream: true` and parse SSE chunks.

## CR-5 context skip — verified live
- `isSimpleGreeting: true` → `_t_context_ms ≈ 50ms` (quota check only, no enrichment)
- Complex query → `_t_context_ms ≈ 309ms` (full parallel fetch: keywords/competitors/audits/missions)
- Log field: `[AI] context built` with `isSimpleGreeting`, `isHypothetical`, `_t_context_ms`, `contextFactor`

## CR-6 instrumentation — confirmed
Both `[AI] context built` and `[AI] Chat complete` are logged on every request with structured fields.
`_t_context_ms` is the primary latency signal before the LLM call.

## CR-7 retry — same-provider only (confirmed by code review)
`aiChat(strict=true)` / `aiStream(strict=true)` loops only over `primaryProviderId`.
No `getInternalFallbackChain()` call. Cross-provider fallback is structurally absent from strict path.

## CR-8 orgId guard — confirmed
`!orgId || orgId === "default"` → 400 ORG_ID_REQUIRED before any DB call or context build.
Test: session with valid UUID orgId passes; "default" sentinel blocked.

## CR-9 list_missions — SQL org_id verified
`WHERE org_id = $1` is the first binding in both `list_missions` and `search_mission`.
18/18 multi-tenant structural tests confirm no cross-org SQL leakage by source analysis.

## Anti-hallucination boundary
When the org has no audit data in DB, the AI has no factual basis to contradict user-stated scores.
This is expected behavior — the guard only prevents making up data, not confirming data it can't verify.
Real protection requires audit data to exist in DB for the org.

## Test fixture pattern for AI routes
To create a valid test session for /api/ai/chat:
1. Insert org (plan='ultra', subscription_status='active') into organizations
2. Insert user into users
3. Insert session via makeToken(userId, orgId) → user_sessions table
4. Insert ai_monthly_usage row with credits_limit=999999999
5. Use token as Bearer for curl against localhost:8081
6. Cleanup: DELETE in reverse dependency order
The org MUST be in organizations table (UUID FK enforced by ai_monthly_usage).

## How to apply
- ALWAYS use stream:true when testing tool calls
- When writing integration tests for tool_executor: mock pool.query() with controlled return values
- For CR-1 / CR-5 / CR-6 / CR-8 tests: the ai-engine.test.ts suite uses source analysis (no live LLM needed)
