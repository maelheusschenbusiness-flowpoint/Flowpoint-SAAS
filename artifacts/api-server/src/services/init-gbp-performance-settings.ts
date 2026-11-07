export interface GbpSchemaQueryClient {
  query(sql: string): Promise<unknown>;
}

const SETTINGS_DEFAULT =
  `'{"locationId":null,"periodDays":30,"goals":{},"alertDropPercent":20}'::jsonb`;

/**
 * Reconcile GBP settings on every startup, independently of one-time migration
 * markers. All operations are additive or policy-only; existing settings rows
 * are never deleted or replaced.
 */
export async function ensureGbpPerformanceSettingsSchema(
  client: GbpSchemaQueryClient,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.gbp_performance_settings (
      org_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT ${SETTINGS_DEFAULT},
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    `ALTER TABLE public.gbp_performance_settings
       ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT ${SETTINGS_DEFAULT}`,
  );
  await client.query(
    `ALTER TABLE public.gbp_performance_settings
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  );
  await client.query(
    `ALTER TABLE public.gbp_performance_settings ENABLE ROW LEVEL SECURITY`,
  );

  const tenantId = `current_setting('app.current_org_id', true)`;
  const policies = [
    {
      name: "gbp_performance_settings_tenant_select",
      command: `FOR SELECT USING (org_id = ${tenantId})`,
    },
    {
      name: "gbp_performance_settings_tenant_insert",
      command: `FOR INSERT WITH CHECK (org_id = ${tenantId})`,
    },
    {
      name: "gbp_performance_settings_tenant_update",
      command: `FOR UPDATE USING (org_id = ${tenantId}) WITH CHECK (org_id = ${tenantId})`,
    },
    {
      name: "gbp_performance_settings_tenant_delete",
      command: `FOR DELETE USING (org_id = ${tenantId})`,
    },
  ];

  for (const policy of policies) {
    await client.query(
      `DROP POLICY IF EXISTS "${policy.name}" ON public.gbp_performance_settings`,
    );
    await client.query(
      `CREATE POLICY "${policy.name}" ON public.gbp_performance_settings ${policy.command}`,
    );
  }
}
