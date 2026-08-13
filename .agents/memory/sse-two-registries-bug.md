---
name: SSE two registries — store._sseByOrg vs events.ts clients Map
description: Why store.broadcast() never reached /api/events clients, and how the bridge is wired.
---

## Rule — SSE bridge in events.ts is mandatory

The codebase has TWO independent SSE client registries that do NOT share data:

1. **`store._sseByOrg`** (in `services/store.ts`) — used by `store.broadcast()`. Chat messages, audit events, billing updates, addon changes all call `store.broadcast(payload, orgId)`.

2. **`events.ts` `clients` Map** — stores `Response` objects for clients connected to `GET /api/events`. These clients receive heartbeats, monitor_snapshot polls, and named SSE events from `broadcastSSE()`.

Without the bridge, `store.broadcast({type:'chat:message', ...})` reaches **zero** frontend clients because the frontend connects to `/api/events` (registry #2), not to any `/api/activity/events` endpoint (registry #1).

## The fix (events.ts GET /events handler)

```typescript
const storeSend = (data: string): void => {
  try { res.write(data); } catch { orgSet.delete(res); store.removeSseClient(orgId, storeSend); }
};
store.addSseClient(orgId, storeSend);
// On disconnect:
store.removeSseClient(orgId, storeSend);
```

**Why:** `store.broadcast()` serializes the payload as `data: JSON\n\n` (unnamed event). The frontend `_sse.onmessage` catches unnamed events and calls `handleSSEEvent(data)`, which dispatches CustomEvents (`fp:chat:message`, `fp:alert:update`, etc.) to document. This chain works once the bridge is in place.

**How to apply:** Any new SSE endpoint that should receive `store.broadcast()` events must register both in its own client set AND call `store.addSseClient()`. Remove on disconnect.

**Note:** `activity.ts` and `billing.ts` already have `store.addSseClient()` for their own `/api/activity/events` and billing SSE endpoints. Only `events.ts` (the main frontend SSE channel) was missing it.
