/**
 * Canonical, global-only system seeds.
 *
 * These rows make a freshly migrated installation usable without creating a
 * customer, user, session, demo record, or tenant-owned resource.  The stable
 * identifiers and values originate from migrations/005_missing_tables.sql.
 */

import { pool } from "@workspace/db";

export const SYSTEM_CONNECTOR_SEEDS = [
  { id: "conn-slack", provider: "slack", config: '{"webhookUrl":""}' },
  { id: "conn-github", provider: "github", config: '{"org":""}' },
  { id: "conn-google", provider: "google", config: "{}" },
  { id: "conn-gsc", provider: "google-search-console", config: "{}" },
  { id: "conn-ga", provider: "google-analytics", config: "{}" },
  { id: "conn-notion", provider: "notion", config: "{}" },
  { id: "conn-discord", provider: "discord", config: '{"webhookUrl":""}' },
] as const;

export interface CanonicalSystemSeedCounts {
  orgSettings: number;
  userPrefs: number;
  connectors: number;
}

/**
 * Inserts only global compatibility/catalog rows. All statements are
 * idempotent and deliberately avoid tenant-scoped records.
 */
export async function runCanonicalSystemSeeds(): Promise<CanonicalSystemSeedCounts> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO org_settings (org_id, plan)
       VALUES ('default', 'standard')
       ON CONFLICT (org_id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO user_prefs (org_id)
       VALUES ('default')
       ON CONFLICT (org_id) DO NOTHING`,
    );

    for (const connector of SYSTEM_CONNECTOR_SEEDS) {
      await client.query(
        `INSERT INTO connectors (id, provider, status, connected, config)
         VALUES ($1, $2, 'disconnected', false, $3)
         ON CONFLICT (id) DO NOTHING`,
        [connector.id, connector.provider, connector.config],
      );
    }

    const result = await client.query<{
      org_settings: string;
      user_prefs: string;
      connectors: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM org_settings WHERE org_id = 'default')::text AS org_settings,
         (SELECT COUNT(*) FROM user_prefs WHERE org_id = 'default')::text AS user_prefs,
         (SELECT COUNT(*) FROM connectors
          WHERE id = ANY($1::text[]))::text AS connectors`,
      [SYSTEM_CONNECTOR_SEEDS.map(({ id }) => id)],
    );

    await client.query("COMMIT");
    const row = result.rows[0]!;
    return {
      orgSettings: Number(row.org_settings),
      userPrefs: Number(row.user_prefs),
      connectors: Number(row.connectors),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}