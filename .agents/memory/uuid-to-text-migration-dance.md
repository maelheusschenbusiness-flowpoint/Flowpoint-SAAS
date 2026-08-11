---
name: uuid→TEXT column migration dependency dance
description: Everything that blocks ALTER COLUMN TYPE uuid→TEXT and how the AI migration handles it; also pg_policies predicate deparse forms for verification.
---

# uuid→TEXT conversion — full dependency dance

**Rule:** before `ALTER TABLE … ALTER COLUMN … TYPE TEXT USING col::text`, you must remove, in one transaction (single `DO $$` block):
1. ALL policies on the table (any policy referencing ANY column blocks the ALTER — SQLSTATE 0A000), not just policies naming the converted column;
2. FKs **on** the table using the column (`pg_constraint conrelid + conkey`);
3. FKs **from other tables** referencing the column (`pg_constraint confrelid + confkey`);
4. views selecting the column (`information_schema.view_column_usage`), `DROP VIEW … CASCADE`;
5. the column default (`DROP DEFAULT`), since `gen_random_uuid()` is invalid for TEXT.

Canonical tenant policies are recreated unconditionally after conversion. Dropped legacy FKs/views are NOT recreated when the new contract writes synthetic TEXT ids that could never satisfy a uuid FK.

**Why:** legacy Supabase schemas carry policies like `USING (user_id IS NOT NULL)` and FKs such as `ai_usage_logs.user_id → auth.users(id)`; missing any of the five blockers makes the ALTER fail, the DO-block transaction rolls back (restoring old policies), and if startup catches the error non-fatally, quota/usage writes silently break in prod.

**How to apply:** see `convertUuidColsToText` in `init-ai-migration.ts`. Pair with:
- a readiness gate: exported `isAiMigrationComplete()` flag set only after full success; AI POST routes return 503 `AI_SCHEMA_NOT_READY` while false — never let a failed schema repair coexist with accepted traffic.
- contract verification that checks (a) every required column exists AND has the required type, (b) RLS enabled via `pg_class.relrowsecurity`, (c) each policy's actual `qual`/`with_check` matches the canonical predicate (INSERT policies keep it in `with_check`, others in `qual`).

# pg_policies predicate deparse forms

pg rewrites the stored predicate; a verification regex must accept BOTH:
- TEXT org_id → `(org_id = current_setting('app.current_org_id'::text, true))`
- uuid/varchar org_id → `((org_id)::text = current_setting('app.current_org_id'::text, true))`

A regex only matching the source form you wrote will fail startup on healthy schemas.

# Harness pattern for migration testing

Bundle the single init file with esbuild `--alias:@workspace/db=<stub exporting a pg Pool>` `--external:<abs pg path>` into CJS, run against a scratch database (`fp_mig_test`) seeded with the legacy shape (uuid cols + legacy policies + FKs + views + duplicate rows). Verify RLS behavior with a NOLOGIN role + `SET LOCAL ROLE` + GUC, including a cross-org INSERT that must fail. Run twice for idempotency. Drop DB + role after.
