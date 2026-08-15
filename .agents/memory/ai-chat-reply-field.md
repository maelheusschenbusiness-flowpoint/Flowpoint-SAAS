---
name: AI chat reply field
description: The /api/ai/chat endpoint with stream:false returns `reply` (not message/response/text/content). Dashboard code must check this field first.
---

# AI chat stream:false response field

**Rule:** When calling `POST /api/ai/chat` with `stream: false`, the server returns `{ reply: "..." }` — not `message`, `response`, `text`, or `content`.

**Why:** The AI route internally uses `reply` as the canonical non-streamed response key. Any code parsing the result that only checks `message || response || text || content` will always get an empty string and the UI will silently show nothing.

**How to apply:** In any dashboard.js code that reads a non-streamed AI response, always include `_result.reply` as the FIRST fallback:
```javascript
const text = (_result.reply || _result.message || _result.response || _result.text || _result.content) || '';
```

Fixed in `fpGetPSIAIReco()` at line ~38914 of dashboard.js.

**GET /api/team/files response format:** Returns a raw JSON array `[{id, name, type, size, sharedBy, createdAt}, ...]` — NOT `{files: [...]}`. Any frontend code or test must handle the array directly.
