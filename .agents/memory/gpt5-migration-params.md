---
name: gpt-5 family API param compatibility
description: gpt-5+ chat completions require different params than gpt-4o/gpt-4o-mini; breaks silently if missed during model migrations.
---

When migrating any OpenAI chat-completion call from a gpt-4.x/gpt-4o-mini model to a gpt-5+ model (gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.x), the request body must change too, or the API call fails at runtime (not compile time):

- `max_tokens` → `max_completion_tokens` (gpt-5+ rejects `max_tokens`)
- `temperature` must be omitted — gpt-5+ always runs at temperature 1 and errors if a custom value is sent

**Why:** TypeScript's OpenAI SDK types don't catch this — the params are optional/valid shapes, so it silently compiles fine and only fails at the live API call. A model-string swap alone is not sufficient.

**How to apply:** When swapping model names project-wide (e.g. deprecation migrations), grep for every `chat.completions.create(` call site and check whether `max_tokens`/`temperature` accompany the changed model. Centralize the branching logic (e.g. `isGpt5Family(model)` helper) rather than patching each call site ad hoc, since plan-tier-based model selection (e.g. `AI_LIMITS[plan].model`) can dynamically resolve to a gpt-5 model at any call site.
