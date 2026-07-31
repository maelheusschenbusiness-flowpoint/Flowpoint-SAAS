---
name: Real data feed isolation
description: Durable rules for notifications, activity, and team chat in FlowPoint.
---

Notifications, activity, and team chat are separate persisted domain feeds. A new account must receive empty states, never seeded demo rows or activity derived from another feed. Every write and read must carry the authenticated `org_id`; real-time updates must preserve server `id`/`createdAt` and deduplicate HTTP, optimistic, and SSE deliveries.

**Why:** Demo seeds and client-side fallbacks made newly created accounts display old monitor notifications, team messages, and artificial session activity; global activity writes also risked cross-organization leakage.

**How to apply:** Keep demo data behind an explicit demo mode, use the dedicated endpoint for each feed, reject client-provided actor/org identity, scope mutations by `org_id`, and keep empty states visible when the backend has no rows.