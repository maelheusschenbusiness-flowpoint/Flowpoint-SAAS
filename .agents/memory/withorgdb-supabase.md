---
name: withOrgDb Supabase role degradation
description: SET LOCAL ROLE app_user fails on Supabase unless explicitly granted; safe fallback via GUC only
---

**Rule:** Wrap `SET LOCAL ROLE app_user` in try/catch; log warn once (flag prevents log flooding); never let it throw.

**Why:** Supabase-managed DBs (and Render Postgres) — the DATABASE_URL connection user (e.g. `postgres`) may not have the `app_user` role granted. When withOrgDb() is called it throws "permission denied to set role app_user", propagating as 503 on every RLS-scoped endpoint (/api/missions, /api/audits, /api/monitors, /api/ai-credits, etc.).

**How to apply:** The `_appUserRoleUnavailable` flag pattern (set once, skips subsequent attempts) is already in lib/db/src/index.ts. Tenant isolation still holds via `SET LOCAL "app.current_org_id"` GUC — all RLS policies check `current_setting('app.current_org_id', true)`. To restore full role isolation on prod: run `GRANT app_user TO <db-user>` in Supabase SQL editor.
