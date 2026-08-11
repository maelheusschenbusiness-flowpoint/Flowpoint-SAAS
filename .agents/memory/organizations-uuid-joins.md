---
name: organizations.id UUID vs text org_id joins
description: organizations.id is UUID; every join/predicate against text org_id columns needs ::text or it 500s
---

# organizations.id (UUID) vs legacy text org_id columns

**Rule:** `organizations.id` is `uuid`. Most tenant tables (`org_settings.org_id`, `team_members.org_id`, `team_invitations.org_id`, `user_sessions.org_id`, …) are `text`. Any SQL that joins or compares them directly (`o.id = tm.org_id`, `WHERE o.id = $1` with a non-UUID param, `COALESCE(name, id)`) throws `operator does not exist: uuid = text` / `COALESCE types text and uuid cannot be matched` and surfaces as a 500.

**Why:** after the TEXT→UUID migration of organizations, routes/team.ts had 5 broken queries (GET /organizations 500, org switch 500) plus a phantom `os.plan_id` column (real name is `os.plan`). Found during Task-503 certification 2026-08-11.

**How to apply:**
- Cast the UUID side: `o.id::text = tm.org_id`, `WHERE o.id::text = $1`, `COALESCE(NULLIF(name,''), id::text)`.
- QA fixtures must create orgs with `randomUUID()` and insert a matching `organizations` row — text org ids like `qa-lot-b-<ts>` are rejected by the uuid column, and the AI fail-closed tracking returns 402 QUOTA_UNRESOLVABLE_ORG for orgs without a UUID organizations row.
- When a route 500s only for some orgs, suspect a uuid/text mismatch before anything else.
