---
name: Team removal canonical identity
description: Safe member removal across legacy email-shaped and current UUID-shaped team records.
---

Team membership removal must use the canonical `users.id` to delete organization membership and revoke sessions. Invitation records created before the identity correction can store the member email in the legacy team identity field, while canonical membership and `user_sessions.user_id_v2` use the UUID.

**Why:** Treating the legacy field as a UUID fails closed under RLS, which protects access but prevents legitimate invited members from being removed.

**How to apply:** New invitation acceptance writes the UUID to the legacy team record. During removal, resolve older email-shaped records through the service-level user lookup before opening the tenant-scoped atomic write transaction; then scope both membership deletion and session revocation to the target organization.