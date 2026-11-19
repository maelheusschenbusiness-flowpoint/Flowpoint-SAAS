export interface AddonSchemaQueryClient {
  query(sql: string): Promise<unknown>;
}

/**
 * Tables des add-ons « replacement » (Organic Campaign Tracker, Technical SEO
 * Fix Verification, SEO Change Impact, Local Presence Optimizer, Local Landing
 * Opportunities, Agency Portfolio Priorities).
 *
 * Elles etaient creees UNIQUEMENT dans le bloc `missing-production-tables-v3`
 * de init-data-tables.ts : sur une base ou ce marqueur est deja enregistre
 * (cas de la base de test), le bloc est saute pour toujours et les routes
 * repondent 500 « relation ... does not exist » des l'add-on achete. Meme
 * remede que `ensureGbpPerformanceSettingsSchema` : reconciliation a chaque
 * demarrage, independante des marqueurs. Tout est additif et idempotent ;
 * aucune ligne existante n'est modifiee.
 */
const TABLES: ReadonlyArray<{ name: string; ddl: string; indexes?: string[] }> = [
  {
    name: "local_presence_settings",
    ddl: `CREATE TABLE IF NOT EXISTS public.local_presence_settings (
      org_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: "local_landing_opportunity_settings",
    ddl: `CREATE TABLE IF NOT EXISTS public.local_landing_opportunity_settings (
      org_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{"services":[],"locations":[],"minimumImpressions":10,"maximumPosition":30}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: "seo_change_impact_settings",
    ddl: `CREATE TABLE IF NOT EXISTS public.seo_change_impact_settings (
      org_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{"lookbackDays":30,"minimumScoreChange":0}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: "agency_portfolio_priority_settings",
    ddl: `CREATE TABLE IF NOT EXISTS public.agency_portfolio_priority_settings (
      org_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{"priorityWeights":{}}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS agency_portfolio_priority_settings_updated_idx ON public.agency_portfolio_priority_settings(updated_at)`,
    ],
  },
  {
    name: "technical_seo_fix_verifications",
    ddl: `CREATE TABLE IF NOT EXISTS public.technical_seo_fix_verifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      url TEXT NOT NULL,
      before_audit_id TEXT NOT NULL,
      after_audit_id TEXT NOT NULL,
      before_issue_count INTEGER NOT NULL,
      after_issue_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, before_audit_id, after_audit_id)
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS technical_seo_fix_verifications_org_created_idx ON public.technical_seo_fix_verifications(org_id, created_at DESC)`,
    ],
  },
  {
    name: "organic_campaign_goals",
    ddl: `CREATE TABLE IF NOT EXISTS public.organic_campaign_goals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      target_position REAL NOT NULL CHECK (target_position > 0),
      minimum_clicks INTEGER NOT NULL CHECK (minimum_clicks >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (org_id, keyword)
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS organic_campaign_goals_org_idx ON public.organic_campaign_goals(org_id)`,
    ],
  },
];

export const REPLACEMENT_ADDON_TABLES = TABLES.map(t => t.name);

const TENANT = `current_setting('app.current_org_id', true)`;

export async function ensureReplacementAddonTables(client: AddonSchemaQueryClient): Promise<void> {
  for (const table of TABLES) {
    await client.query(table.ddl);
    for (const index of table.indexes ?? []) await client.query(index);
    await client.query(`ALTER TABLE public."${table.name}" ENABLE ROW LEVEL SECURITY`);
    // Memes noms et memes conditions que `applyTenantRls` (init-data-tables.ts).
    for (const [op, command] of [
      ["select", `FOR SELECT USING     (COALESCE(org_id,'default') = ${TENANT})`],
      ["insert", `FOR INSERT WITH CHECK (COALESCE(org_id,'default') = ${TENANT})`],
      ["update", `FOR UPDATE USING     (COALESCE(org_id,'default') = ${TENANT})`],
      ["delete", `FOR DELETE USING     (COALESCE(org_id,'default') = ${TENANT})`],
    ] as const) {
      await client.query(`DROP POLICY IF EXISTS "tenant_${op}" ON public."${table.name}"`);
      await client.query(`CREATE POLICY "tenant_${op}" ON public."${table.name}" ${command}`);
    }
  }
}
