---
name: Production test session via PostgREST
description: How to mint a working authenticated session against the live Render/Supabase deployment, and why email-shaped org_ids are rejected
---

# Production test session (Supabase PostgREST)

## Rule
A production test session inserted directly into `user_sessions` **must** carry a UUID
`org_id` backed by real rows in `organizations` and `users`. An email-shaped `org_id`
(the legacy FlowPoint convention) is actively destroyed at request time.

**Why:** the org-context middleware rejects any session whose `org_id` is not a UUID and
contains `@` — it deletes the session, clears the cookie, and returns
`401 {"error":"session_expired","reason":"legacy_session"}`. This is the auth v2 guard,
so old QA recipes that use `org_id = "qa-suite-<ts>@qa.internal"` silently stop working
against production even though they still work locally.

## How to apply
Local `DATABASE_URL` points at the Replit-local postgres, **not** Supabase. To touch the
production DB use PostgREST at `SUPABASE_URL` with `SUPABASE_SERVICE_ROLE_KEY` (both are
present in the workspace env; the service role bypasses RLS).

Minimum row set for a session that passes org-context:
1. `organizations` — `id` = fresh UUID, `owner_user_id` = user UUID, `status:'active'`, a plan
2. `users` — `id` = user UUID, `email`, `status:'active'`
3. `org_settings` — `org_id` = the organization UUID
4. `user_sessions` — `org_id` = organization UUID, `user_id_v2` = user UUID, `expires_at` in the future

Send the token as `Cookie: fp_token=<token>` (or `Authorization: Bearer`).

**Always clean up afterwards**, including `google_oauth_states` if an OAuth route was hit —
those rows are keyed by `org_id` and outlive the session. Verify deletion with a follow-up
`select` per table; a 200 from DELETE alone does not prove the row set is empty.
