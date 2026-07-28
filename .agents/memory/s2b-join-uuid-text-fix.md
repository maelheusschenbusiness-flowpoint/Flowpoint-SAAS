---
name: S2b org_members JOIN uuid=text fix
description: organizations.id is UUID in prod; organization_members.organization_id is TEXT; any JOIN/WHERE between them needs an explicit ::text cast on the UUID side.
---

# S2b JOIN — UUID = TEXT operator mismatch

## The rule
Any query that joins or compares `organizations.id` to a TEXT column (like `organization_members.organization_id`) must cast explicitly: `o.id::text = om.organization_id`. Without it, PostgreSQL throws **42883** ("operator does not exist: uuid = text").

**Why:** `organizations.id` is declared as TEXT in `init-data-tables.ts` and `init-phase1-users.ts` has a self-healing ALTER to coerce UUID→TEXT on boot. That self-healing fails silently in production (likely an undropped FK), so `organizations.id` remains UUID on Render/Supabase. `organization_members.organization_id` is TEXT (canonical, per `init-phase1-users.ts:75`).

**How to apply:** Any SQL query anywhere in the codebase that does `organizations.id = <text_expression>` must use `organizations.id::text = <text_expression>`. The local dev DB has id as TEXT so the bug is invisible locally — only prod surfaces it.

## Fix applied
- `artifacts/api-server/src/routes/auth.ts:1098` — `JOIN organizations o ON o.id::text = om.organization_id`

## Still outstanding
- `planGate.ts:34` — `SELECT plan FROM organizations WHERE id = $1` with a TEXT orgId — will throw 22P02 for legacy sessions where orgId is an email string (different bug; tracked as task #223 + #225)
- The self-healing ALTER itself needs to be hardened (task #225)

## Regression test
`.local/qa_magic_link_regression.cjs` — 6 assertions: 200, body.ok, fp_token cookie, 410 on reuse, token.used=true, user_sessions row created.
