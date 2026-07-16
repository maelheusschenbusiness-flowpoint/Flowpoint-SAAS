---
name: AI provider messages injection fix
description: openai-provider ignores systemPrompt when opts.messages is provided; must pass full array.
---

## Rule
When calling `aiStream` or `aiChat` with an `opts.messages` array, the OpenAI provider uses that array directly and **ignores** `opts.systemPrompt`. The full messages array — including `{ role: "system", content: finalSystemPrompt }` at index 0 — must be passed as `opts.messages`.

**Why:** The provider implementation is:
```typescript
const messages = opts.messages ?? [
  { role: "system", content: opts.systemPrompt },
  { role: "user",   content: opts.userPrompt },
];
```
When `opts.messages` is provided, the `??` short-circuits and `opts.systemPrompt` is never used.

**Bug pattern:** Calling with `messages: messages.slice(1)` (history + user, no system) → provider receives a conversation with no system prompt → attachments, instructions, and fpContext are all silently dropped.

**Fix pattern (ai.ts):**
```typescript
const finalSystemPrompt = [systemPromptBase, fpContext, attachmentContext].filter(Boolean).join("\n\n");
const messages = [
  { role: "system", content: finalSystemPrompt },
  ...history,
  { role: "user", content: message },
];
// Pass FULL messages array — provider picks up system message at index 0
aiStream({ ..., systemPrompt: finalSystemPrompt, messages });
```

**Test proof:** `call.messages.find(m => m.role === "system")?.content` must contain the attachment block and unique extracted text.
