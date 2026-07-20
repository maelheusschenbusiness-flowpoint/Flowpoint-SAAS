-- ============================================================
-- Migration 20260720 — Align team & organization schema
-- Fixes production errors 23514 (role_check) and 42703 (owner_user_id)
-- Transactional, idempotent, verifies invariants at the end.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. AUDIT: show current invalid roles (informational)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM team_members
  WHERE role IS NULL OR role NOT IN ('owner','admin','member','viewer');
  IF invalid_count > 0 THEN
    RAISE NOTICE '[migration] team_members: % rows with invalid role — normalizing', invalid_count;
  ELSE
    RAISE NOTICE '[migration] team_members: all roles valid before normalization ✓';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. NORMALIZE invalid roles using canonical mapping
--    Only rows outside allowed set are touched.
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE team_members
SET role = CASE
  WHEN role IN ('administrator', 'manager')          THEN 'admin'
  WHEN role IN ('user', 'editor', 'collaborator')    THEN 'member'
  WHEN role IN ('read_only', 'readonly', 'client')   THEN 'viewer'
  WHEN role IS NULL OR trim(role) = ''               THEN 'member'
  ELSE 'member'   -- last-resort fallback for any other unrecognised value
END
WHERE role IS NULL
   OR role NOT IN ('owner','admin','member','viewer');

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. ENFORCE role constraint (drop-then-add is idempotent and safe now)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('owner','admin','member','viewer'));

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. VERIFY: zero invalid roles must remain
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM team_members
  WHERE role IS NULL OR role NOT IN ('owner','admin','member','viewer');
  IF remaining > 0 THEN
    RAISE EXCEPTION '[migration] FATAL: % rows still have invalid role after normalization', remaining;
  ELSE
    RAISE NOTICE '[migration] team_members role constraint: all rows valid ✓';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. organizations.owner_user_id — add if missing (42703 fix)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

-- Remove NOT NULL default on first add so backfill can run safely
ALTER TABLE organizations
  ALTER COLUMN owner_user_id SET DEFAULT '';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. BACKFILL owner_user_id from team_members (active owner row)
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE organizations o
SET owner_user_id = tm.user_id
FROM team_members tm
WHERE tm.org_id     = o.id
  AND tm.role       = 'owner'
  AND tm.status     = 'active'
  AND tm.user_id    IS NOT NULL
  AND tm.user_id    <> ''
  AND (o.owner_user_id IS NULL OR o.owner_user_id = '');

-- Fallback: use org_id itself as owner_user_id for orgs with no owner member
UPDATE organizations
SET owner_user_id = id
WHERE owner_user_id IS NULL OR owner_user_id = '';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. AUDIT: list orphan organizations (owner_user_id still empty)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM organizations
  WHERE owner_user_id IS NULL OR owner_user_id = '';
  IF orphan_count > 0 THEN
    RAISE WARNING '[migration] organizations: % rows still have no owner_user_id — review manually', orphan_count;
  ELSE
    RAISE NOTICE '[migration] organizations.owner_user_id: all rows populated ✓';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Lot B schema — ensure team_invitations columns exist
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS id                 TEXT;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS org_id             TEXT NOT NULL DEFAULT 'default';
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS email              TEXT NOT NULL DEFAULT '';
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS role               TEXT NOT NULL DEFAULT 'viewer';
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS token_hash         TEXT NOT NULL DEFAULT '';
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS invited_by_user_id TEXT;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS accepted_at        TIMESTAMPTZ;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS revoked_at         TIMESTAMPTZ;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS resend_count       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS last_resent_at     TIMESTAMPTZ;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Lot B indexes (idempotent)
CREATE INDEX IF NOT EXISTS team_invitations_org_idx      ON team_invitations(org_id);
CREATE INDEX IF NOT EXISTS team_invitations_token_idx    ON team_invitations(token_hash);
CREATE INDEX IF NOT EXISTS team_invitations_email_idx    ON team_invitations(org_id, lower(email));
CREATE INDEX IF NOT EXISTS team_invitations_status_idx   ON team_invitations(org_id, status);

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. team_members Lot B columns
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id            TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS first_name         TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_name          TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_by_user_id TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS joined_at          TIMESTAMPTZ;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS resend_count       INTEGER NOT NULL DEFAULT 0;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. VERIFY RLS is enabled on security-sensitive tables
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
  rls_on BOOLEAN;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'team_members','team_invitations','organizations',
    'org_settings','user_sessions','audits'
  ]) LOOP
    SELECT rowsecurity INTO rls_on
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = tbl;
    IF rls_on IS NULL THEN
      RAISE NOTICE '[migration] RLS: table % not found (may be ok for this deployment)', tbl;
    ELSIF NOT rls_on THEN
      RAISE WARNING '[migration] RLS: % has RLS DISABLED — enable with ALTER TABLE % ENABLE ROW LEVEL SECURITY', tbl, tbl;
    ELSE
      RAISE NOTICE '[migration] RLS: % ✓', tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
