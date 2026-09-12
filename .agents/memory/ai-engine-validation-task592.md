---
name: AI engine validation — Task #592
description: Real-world validation findings from the 9 CR-fix overhaul; critical behavioral discoveries about streaming vs non-streaming, tool calling, context timing, anti-hallucination, and TTFT.
---

# AI engine validation — Task #592

## Key Discovery: Tool calling is SSE-only

`stream: false` calls `aiChat()` — a single-shot LLM call with NO tool loop.
`stream: true` + `enableTools: true` calls `runToolCallingLoop()` (ai.ts:1113) which actually dispatches tools.
`enableTools` MUST be explicitly set in the request body (`enableTools: true`) — it does not default.

**Why:** Tests run with `stream: false` or without `enableTools: true` will NEVER see tool calls.
Any behavior test for tool invocation MUST use `stream: true, enableTools: true` and parse SSE chunks.

## CR-10 TTFT: Simple greetings bypass tool loop (added this session)

`runToolCallingLoop` uses `aiChatWithTools` (fully blocking, non-streaming internal LLM call).
TTFT for ALL requests through the tool loop = full LLM round (~18-29s for GPT-5).

Fix (ai.ts line ~2042): `if (enableTools && hasAnyToolPermission && !isSimpleGreeting)`.
Simple greetings route to real `aiStream` (token-by-token streaming):
- "Bonjour" TTFT: 12143ms → 6947ms (-43%)
- Non-greeting content TTFT: still 18-29s (GPT-5 model limit, not fixable without model change)

Immediate typing indicator also added before any LLM call: `data: {"typing":true}` → <100ms for ALL requests.

## Anti-hallucination: 3-tier data distinction (added this session)

System prompt now has "DONNÉES — DISTINCTION IMPÉRATIVE" with 3 tiers:
- A. FlowPoint verified → cite directly
- B. User-provided → always attribute: "D'après le score que vous m'indiquez..."
- C. Unavailable → say not available, never confirm

Verified 4 scenarios live:
- Scenario A (user says 98/100, DB empty): ✅ "D'après le 98/100 que vous m'indiquez..."
- Scenario B (no score, DB empty): ✅ "Votre score n'est pas encore disponible..."
- Scenario C (user says 98, FlowPoint shows 28): ✅ Cited both, kept FlowPoint as source of truth
- Scenario D (explicit hypothetical): ✅ Stayed in hypothetical register

## CRUD streaming validation (stream:true, enableTools:true) — all PASS

- CREATE: `create_mission` called 3×, confirmationLevel=preview → confirm via `/api/ai/conversations/:id/confirm` → DB row verified
- LIST: `list_missions` called inline (confirmationLevel=none) → real DB data returned → final text references actual titles
- UPDATE: `search_mission` then `update_mission` called → confirmed → DB priority=high verified
- DELETE: `search_mission` then `delete_mission` called → confirmed → DB row gone verified

The confirmation flow: SSE emits `confirmation_request` with `proposalId` then closes.
Confirm via: `POST /api/ai/conversations/:convId/confirm { proposalId }` → executes tool + synthesis.
Each create_mission requires ONE confirmation_request per tool call. For N missions: N separate turns/confirmations.

## CR-5 context skip — verified live

- `isSimpleGreeting: true` → `_t_context_ms ≈ 50ms` (no enrichment)
- Complex query → `_t_context_ms ≈ 309ms` (full parallel fetch: keywords/competitors/audits/missions)

## CR-7 retry — same-provider only (confirmed by code review)

`aiChat(strict=true)` / `aiStream(strict=true)` loops only over `primaryProviderId`.
No `getInternalFallbackChain()` call. Cross-provider fallback is structurally absent from strict path.

## CR-8 orgId guard — confirmed

`!orgId || orgId === "default"` → 400 ORG_ID_REQUIRED before any DB call or context build.

## Agent differentiation — confirmed by code structure

5 specialist endpoints, each with distinct system prompt + input contract:
- `/api/ai/chat` → general chat with `buildFlowpointContext`, returns `reply`
- `/api/ai/seo` → requires `url`, reads audits/PSI/keywords, "Tu es un expert SEO technique", returns `recommendations`
- `/api/ai/local` → requires `business`/`location`, "Tu es un expert Local SEO et GBP", returns `recommendations`
- `/api/ai/conversion` → CRO/funnel focus, "Tu es un expert CRO et UX", returns `recommendations`
- `/api/ai/competitors` → requires `competitors[]`, "Tu es un analyste stratégique SEO", returns `analysis`

## Pre-existing test failures (not from this session)

`ai-chat-attachments.test.ts`: fails with `res.flushHeaders is not a function` — test mock doesn't implement it; `res.flushHeaders()` was added in SSE transport hardening (previous session).
`ai-economy.test.ts`: some tests get 401 (auth setup issue in test fixture) — pre-existing.
Total: 17 pre-existing failures across 7 files. My changes did NOT introduce new failures.
New test count: 997 total (980 passing, 17 pre-existing failures).

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

- ALWAYS use `stream: true, enableTools: true` when testing tool calls
- Parse SSE events: `typing`, `tool_call`, `confirmation_request`, `tool_result`, `delta`, `_ai`, `[DONE]`
- For confirmationLevel="preview"/"full": call POST /api/ai/conversations/:id/confirm with proposalId
- For CR-1 / CR-5 / CR-6 / CR-8 tests: source analysis (no live LLM needed)
- For anti-hallucination tests: check prompt contains "d'après" / "que vous m'indiquez" for user-provided data
