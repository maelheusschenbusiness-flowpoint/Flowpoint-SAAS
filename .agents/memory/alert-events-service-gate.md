---
name: Alert-events service-only gate
description: POST /alert-events blocked for user sessions; service credential bypass in routes/index.ts
---

## Rule
POST /alert-events must only be called by the internal service pipeline (via API_SECRET_KEY / X-Api-Key header). User Bearer sessions must receive 404.

## Implementation
Gate in `routes/alert-rules.ts` checks `req.userId !== "service"` (NOT role) and returns 404 for any non-service caller.

**Why userId, not role:** orgContext.ts sets `role="admin"` for the service key, but that role is shared with human admin users. The distinguishing field is `userId="service"` which is only set for the API_SECRET_KEY path.

**Why:** Service pipelines create alert events internally via `createAlertEvent()`. The HTTP endpoint exists only as an emergency backdoor for internal workers — never for user sessions.

## Bypass in routes/index.ts
The service credential (`userId="service"`, `orgId="default"`) must be allowed past the org-context gate middleware. Without this, the service token is blocked by the `orgId !== "default"` guard before it ever reaches the route. Added explicit bypass:
```ts
if (req.userId === "service") { next(); return; }
```

## QA test files updated
- `qa_lot_b2.mjs`: uses `SVC_HEADERS` (X-Api-Key) for POST /alert-events
- `qa_lot_b3.mjs`: `apiSvc()` helper + replaced both POST /alert-events calls
