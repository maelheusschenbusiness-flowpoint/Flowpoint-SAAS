---
name: RLS local dev setup
description: How to make req.orgDb / withOrgDb work in local dev (app_user provisioning)
---

# Rule
The `app_user` PostgreSQL role required by `withOrgDb` (SET LOCAL ROLE app_user)
is created by migration 011_app_user.sql which runs on Supabase ONLY.
In local dev the role is absent → every req.orgDb call throws on SET LOCAL ROLE → 500.

**Fix**: `init-rls-setup.ts` provisioned at server startup creates app_user + GRANTs
if not already present (idempotent). Call it first in main() before other init scripts.

**Why**: Migrations are Supabase-only. Local dev needs the role to evaluate req.orgDb.

**How to apply**: Any time req.orgDb calls return 500 in local dev, check if app_user
exists via `SELECT rolname FROM pg_roles WHERE rolname='app_user'`. If missing,
verify initRlsSetup() is called at startup in index.ts.

# Table schema mismatches (local vs Supabase)
Tables created by old init scripts or legacy migrations can have different schemas
than what routes expect. Common pattern:
- Run `ALTER TABLE ADD COLUMN IF NOT EXISTS` for all expected columns
- For NOT NULL columns that can't be added safely: `ALTER COLUMN "x" DROP NOT NULL` + SET DEFAULT
- Use `run()` helper (non-fatal) for idempotent ALTER TABLE statements

Tables that required patching:
- workflow_runs: missing org_id, completed_at, error, output
- report_exports: didn't exist locally, created via init-data-tables
- team_messages: legacy "from"/"text" NOT NULL columns incompatible with new INSERT
