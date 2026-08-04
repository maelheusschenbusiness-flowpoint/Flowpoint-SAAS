---
name: Team messages pitfalls
description: Why chat messages "disappeared" and the rules that prevent it
---

- Never filter team_messages by `created_at >= organizations.created_at` — it silently hides legitimate history (removed 2026-08-04).
- Channels are stored in canonical bare lowercase form ("general", "seo", …). All reads/writes must go through a `normChannel()` that trims, strips leading `#`, and lowercases; the UI shows `#name` as a label only.
- GET handlers return `[]` on error for UI resilience but MUST `console.error` the cause — silent `[]` made DB/RLS failures look like empty channels.

**Why:** users reported persisted messages vanishing across the Messages popover, Équipe chat and Command Center; root cause was the org-created_at cutoff plus errors swallowed as empty arrays.
**How to apply:** any new message/feed endpoint — no time cutoffs tied to org creation, normalize channel keys, log swallowed errors.
