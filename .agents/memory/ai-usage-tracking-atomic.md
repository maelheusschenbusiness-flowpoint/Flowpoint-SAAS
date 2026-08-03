---
name: AI usage tracking — atomic, idempotent, fail-closed
description: durable invariants for AI credit tracking and quota gating
---

## Invariants
- Usage log + monthly aggregate are written in ONE transaction, gated on the idempotent log insert returning a row — replays never double-bill, failures never half-write.
- Every quota/economy/debit path canonicalizes legacy org ids to the canonical UUID BEFORE any usage read/write; canonicalizing only at record time leaves the pre-request quota gate broken.
- Distinguish verified absence (org truly unresolvable → 402, unrecoverable) from lookup unavailability (DB failure → 503, retryable). Never map a transient failure to a permanent verdict.
- All quota gates fail CLOSED on any persistence/read failure — a "degraded allow" grants unlimited untracked provider spend.
- A recording failure must propagate to callers; paths that cannot await (SSE) enqueue the payload to a persisted outbox replayed by a worker — durable across restarts, safe via the idempotency key. Timer-only in-process retries are NOT acceptable compensation.

**Why:** legacy ids threw uuid-cast errors that quota checks converted into unlimited allows; split writes made the dashboard diverge from real provider consumption; a completion review rejected timer-only retries and fail-open fallbacks three times before these invariants passed.

**How to apply:** new AI endpoints must reuse the single canonical record path and never add a catch that answers "allow" or returns a success-shaped debit when usage state is unreadable.
