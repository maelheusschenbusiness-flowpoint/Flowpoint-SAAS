---
name: Chat notifications per-recipient rule
description: Why chat alerts need per-recipient notification rows, never shared org-wide read state
---

# Team chat identity & per-recipient notifications

**Rule 1:** the server must never decide `self` for an SSE broadcast — the broadcast reaches every client of the org. Broadcast a stable `senderId`; each client compares it against its own identity. `/api/me` must expose `userId` for this comparison.
**Why:** a broadcast marked `self:true` suppressed every teammate's unread badge.

**Rule 2:** notification read state used as recipient-specific state must be per-recipient rows (`notifications.recipient_id`, NULL = org-wide), and every read/read-all/delete must be scoped to `recipient_id IS NULL OR recipient_id = ANY(requester identities)`. Client-side filtering of a shared org row is NOT sufficient — code review rejects it: one member's "mark all read" would clear other members' alerts.
**Why:** rejected in completion review as an authorization/data-integrity regression.

**How to apply:** chat message POST fans out one notification row per active team member (excluding the sender under all their identities: userId AND email). Requester identities = `[orgContext.userId, orgContext.email]` since `recipient_id` may hold either. Multi-user regression test pattern: sender + A + B; A's read-all must not touch B's row.
