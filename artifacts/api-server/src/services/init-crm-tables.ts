/**
 * CRM Integrations : tables absentes de la production, lues/ecrites par services/crm/crm-core.ts.
 * Additif et idempotent (CREATE ... IF NOT EXISTS, aucun DROP/DELETE de donnees, aucune FK sur
 * org_id), execute a chaque demarrage, independamment du bloc conditionnel v3 de init-data-tables.
 * Schema identique a celui de la branche beta (Test-Replit). Les jetons OAuth sont stockes
 * CHIFFRES (AES-256-GCM) dans crm_integrations.access_token / refresh_token : il n'existe pas
 * de table crm_tokens.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

type Client = import("pg").PoolClient;

async function run(client: Client, label: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err) {
    logger.warn({ label, err: err instanceof Error ? err.message : String(err) }, "[crm-tables] DDL step failed (non-fatal)");
  }
}

async function applyTenantRls(client: Client, t: string): Promise<void> {
  const guc = `current_setting('app.current_org_id', true)`;
  await run(client, `${t} rls`, `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
  for (const [op, cmd] of [
    ["select", `FOR SELECT USING     (COALESCE(org_id,'default') = ${guc})`],
    ["insert", `FOR INSERT WITH CHECK (COALESCE(org_id,'default') = ${guc})`],
    ["update", `FOR UPDATE USING     (COALESCE(org_id,'default') = ${guc})`],
    ["delete", `FOR DELETE USING     (COALESCE(org_id,'default') = ${guc})`],
  ] as [string, string][]) {
    await run(client, `${t} drop tenant_${op}`, `DROP POLICY IF EXISTS "tenant_${op}" ON "${t}"`);
    await run(client, `${t} create tenant_${op}`, `CREATE POLICY "tenant_${op}" ON "${t}" ${cmd}`);
  }
}

export async function initCrmTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await run(client, "crm_oauth_states", `
      CREATE TABLE IF NOT EXISTS crm_oauth_states (
        state_hash TEXT        PRIMARY KEY,
        org_id     TEXT        NOT NULL,
        provider   TEXT        NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await run(client, "crm_oauth_states idx", `CREATE INDEX IF NOT EXISTS crm_oauth_states_expiry_idx ON crm_oauth_states(expires_at)`);
    await run(client, "crm_oauth_states org idx", `CREATE INDEX IF NOT EXISTS crm_oauth_states_org_idx ON crm_oauth_states(org_id)`);
    await applyTenantRls(client, "crm_oauth_states");

    await run(client, "crm_contacts", `
      CREATE TABLE IF NOT EXISTS crm_contacts (
        id                  TEXT        PRIMARY KEY,
        org_id              TEXT        NOT NULL DEFAULT 'default',
        provider            TEXT        NOT NULL DEFAULT '',
        external_id         TEXT        NOT NULL DEFAULT '',
        name                TEXT,
        email               TEXT,
        phone               TEXT,
        status              TEXT,
        source              TEXT,
        external_updated_at TEXT,
        synced_at           TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await run(client, "crm_contacts unique", `CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_org_provider_ext_idx ON crm_contacts(org_id, provider, external_id)`);
    await run(client, "crm_contacts idx", `CREATE INDEX IF NOT EXISTS crm_contacts_org_created_idx ON crm_contacts(org_id, created_at DESC)`);
    await applyTenantRls(client, "crm_contacts");

    await run(client, "crm_webhook_events", `
      CREATE TABLE IF NOT EXISTS crm_webhook_events (
        provider    TEXT        NOT NULL,
        event_id    TEXT        NOT NULL,
        org_id      TEXT        NOT NULL DEFAULT 'default',
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider, event_id)
      )`);
    await run(client, "crm_webhook_events idx", `CREATE INDEX IF NOT EXISTS crm_webhook_events_org_idx ON crm_webhook_events(org_id)`);
    await applyTenantRls(client, "crm_webhook_events");

    // Mapping de champs (lu/ecrit par crm-service.ts) : deja presente en production, absente d'une base neuve.
    await run(client, "crm_field_mappings", `
      CREATE TABLE IF NOT EXISTS crm_field_mappings (
        id                 TEXT        PRIMARY KEY,
        crm_integration_id TEXT        NOT NULL,
        entity_type        TEXT        NOT NULL,
        flowpoint_field    TEXT        NOT NULL,
        crm_field          TEXT        NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        org_id             TEXT        NOT NULL DEFAULT 'default'
      )`);

    // Une seule synchronisation `running` par integration (verrou sans course).
    await run(client, "crm_sync_logs one running",
      `CREATE UNIQUE INDEX IF NOT EXISTS crm_sync_logs_one_running_idx ON crm_sync_logs(crm_integration_id) WHERE status = 'running'`);
  } finally {
    client.release();
  }
}
