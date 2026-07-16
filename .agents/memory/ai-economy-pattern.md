---
name: AI Economy Mode Pattern
description: Phase 2 Étape 2 — progressive economy within same provider, never cross-provider switch
---

# AI Economy Mode — Provider-Isolation Rule

The rule: **provider never changes**. Only model and tokens degrade within the same provider family.

**Why:** Cross-provider switch would require different API credentials, different context formats,
and could change the quality contract the user signed up for. Economy stays within the signed provider.

**How to apply:**
- `resolveEconomyPolicy()` returns `effectiveModel` from `ECONOMY_MODELS[provider]` — always same provider family
- `effectiveModel` for openai is always `gpt-*`, anthropic always `claude-*`, gemini always `gemini-*`
- EXHAUSTED → 402 QUOTA_EXCEEDED before any provider call

**Tier map:** NORMAL=100%, OPTIMIZED=85% tokens, ECONOMY=65% tokens+downgrade, CRITICAL=45%+downgrade, EXHAUSTED=402

**Economy models:** openai→gpt-5-mini, anthropic→claude-haiku-4-5, gemini→gemini-3-flash-preview

**Context factor:** NORMAL=1.0, OPTIMIZED=0.85, ECONOMY=0.60, CRITICAL=0.35

**Test E note:** test org plan limit comes from store.me.plan fallback (not always "standard").
Insert credits_used matching actual plan limit (500k for pro) to trigger EXHAUSTED.
