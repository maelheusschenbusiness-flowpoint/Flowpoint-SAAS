---
name: AI rate-limit buckets — chat vs batch separation
description: Why AI chat hit premature 429s and how the limiter is structured now; plus live-cert gotchas (action verbs, monthly token quota).
---

## The rule

Interactive AI chat and background/batch AI endpoints must NEVER share a rate-limit bucket, and post-auth endpoints must never carry per-IP limiters.

**Why:** two structural causes produced premature 429s in normal 15–20 message conversations:
1. A hidden per-IP limiter (30/min) inside `chatHandler` fired at request #31 — wrong key for a post-auth endpoint (all requests of an org share the IP in practice; key must be orgId).
2. A single `ai:${orgId}` bucket was shared by chat AND ~11 batch `/ai/*` endpoints — background AI features (insights, batch scoring) drained the plan budget (standard = 10/min) out from under the user's chat.

**How to apply:**
- `aiLimitMiddleware(bucketPrefix, source)` factory in `middlewares/rateLimiter.ts` → `aiRateLimit` (bucket `ai:`, source `ai_batch`) and `aiChatRateLimit` (bucket `ai:chat:`, source `ai_chat`). Chat route uses `aiChatRateLimit`.
- Every 429 response includes `details.source` so a limiter can be attributed from logs — never add an anonymous limiter.
- Do not raise thresholds to fix premature 429s; find the bucket collision instead.
- Tests documenting both causes: `src/routes/ai-chat-ratelimit.test.ts`.

## Live-cert gotchas

- Prompts must use explicit action verbs matched by `_CI_ACTION_RE` (crée, modifie, supprime, ajoute, planifie…) or the intent classifier exposes only read tools — "Passe la mission X en priorité haute" gets NO write tools and the model honestly says it can't. Use "Modifie la mission…".
- Heavy repeated certs exhaust the org's MONTHLY token quota (`ai_monthly_usage.tokens_used` vs plan `tokenLimit`) → a legitimate 429 "AI quota exceeded". Reset the QA org's current-month row (`tokens_used=0, credits_used=0`) rather than touching limits.
- Cert script lives at `tools/task614-cert.mjs` (single-conversation CRUD + calendar + interruption, throws on any 429).
