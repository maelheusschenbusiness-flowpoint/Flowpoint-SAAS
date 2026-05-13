/**
 * FlowPoint Realtime — Server-Sent Events (SSE)
 *
 * Architecture:
 *   - Single SSE endpoint: GET /api/activity/events
 *   - Clients subscribe and receive all broadcast events
 *   - store.broadcast(payload) fans out to all connected clients
 *   - store.sseClients is a Set<Response> managed in services/store.ts
 *
 * Event types pushed to clients:
 *   fp:activity          — new activity log entry
 *   fp:monitor:status    — monitor up/down state change
 *   fp:monitor:ping      — manual ping result
 *   fp:alert:triggered   — alert rule fired
 *   fp:audit:progress    — audit phase update
 *   fp:audit:completed   — audit finished with score
 *   fp:report:ready      — PDF report ready for download
 *   fp:billing:updated   — subscription plan change
 *   fp:chat:message      — new team chat message
 *   fp:notification      — new in-app notification
 *   fp:ai:completed      — AI analysis result ready
 *
 * Client usage (fp-backend.js):
 *   const es = new EventSource('/api/activity/events');
 *   es.addEventListener('fp:monitor:status', e => { ... });
 *
 * Scaling note:
 *   For multi-instance deployments, replace the in-process Set with a
 *   Redis pub/sub adapter (ioredis) — each instance subscribes to the
 *   same Redis channel and fans out to its local SSE clients.
 */

export const SSE_EVENTS = {
  ACTIVITY: "fp:activity",
  MONITOR_STATUS: "fp:monitor:status",
  MONITOR_PING: "fp:monitor:ping",
  ALERT_TRIGGERED: "fp:alert:triggered",
  AUDIT_PROGRESS: "fp:audit:progress",
  AUDIT_COMPLETED: "fp:audit:completed",
  REPORT_READY: "fp:report:ready",
  BILLING_UPDATED: "fp:billing:updated",
  CHAT_MESSAGE: "fp:chat:message",
  NOTIFICATION: "fp:notification",
  AI_COMPLETED: "fp:ai:completed",
} as const;

export type SseEventType = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];
