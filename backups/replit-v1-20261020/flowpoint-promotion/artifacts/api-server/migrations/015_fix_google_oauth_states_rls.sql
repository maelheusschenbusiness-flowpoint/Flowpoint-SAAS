-- Migration 015 — Enable RLS on google_oauth_states (missed in 014)
ALTER TABLE IF EXISTS google_oauth_states ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS google_oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select" ON google_oauth_states;
DROP POLICY IF EXISTS "tenant_insert" ON google_oauth_states;
DROP POLICY IF EXISTS "tenant_update" ON google_oauth_states;
DROP POLICY IF EXISTS "tenant_delete" ON google_oauth_states;
CREATE POLICY "tenant_select" ON google_oauth_states FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON google_oauth_states FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON google_oauth_states FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON google_oauth_states FOR DELETE USING (org_id = current_setting('app.current_org_id', true));
CREATE INDEX IF NOT EXISTS idx_google_oauth_states_org_id ON google_oauth_states (org_id);
