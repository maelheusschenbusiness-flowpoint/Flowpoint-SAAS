import { pool } from "@workspace/db";

export const CRM_PROVIDERS = [
  { id: 'hubspot',    name: 'HubSpot',     color: '#ff7a59', icon: '🎯', authUrl: 'https://app.hubspot.com/oauth/authorize', scopes: ['contacts','crm.objects.contacts.read','crm.objects.deals.read'] },
  { id: 'salesforce', name: 'Salesforce',  color: '#00a1e0', icon: '☁️', authUrl: 'https://login.salesforce.com/services/oauth2/authorize', scopes: ['api','refresh_token'] },
  { id: 'pipedrive',  name: 'Pipedrive',   color: '#00c851', icon: '🔧', authUrl: 'https://oauth.pipedrive.com/oauth/authorize', scopes: ['contacts:read','deals:read','persons:read'] },
  { id: 'zoho',       name: 'Zoho CRM',    color: '#e42527', icon: '🔴', authUrl: 'https://accounts.zoho.com/oauth/v2/auth', scopes: ['ZohoCRM.modules.READ'] },
  { id: 'monday',     name: 'Monday CRM',  color: '#ff3d57', icon: '📋', authUrl: 'https://auth.monday.com/oauth2/authorize', scopes: ['boards:read','me:read'] },
  { id: 'airtable',   name: 'Airtable',    color: '#18bfff', icon: '📊', authUrl: 'https://airtable.com/oauth2/v1/authorize', scopes: ['data.records:read','schema.bases:read'] },
  { id: 'notion',     name: 'Notion CRM',  color: '#ffffff', icon: '📄', authUrl: 'https://api.notion.com/v1/oauth/authorize', scopes: [] },
  { id: 'close',      name: 'Close CRM',   color: '#7b68ee', icon: '🔑', authUrl: 'https://app.close.com/oauth2/authorize', scopes: [] },
] as const;

export type CrmProvider = typeof CRM_PROVIDERS[number]['id'];

import { PLAN_DEFINITIONS } from "../lib/plans.js";

export class CrmCapabilityUnavailableError extends Error {
  readonly code = "CRM_SYNC_UNAVAILABLE";

  constructor() {
    super("La synchronisation réelle des fournisseurs CRM n'est pas encore implémentée.");
    this.name = "CrmCapabilityUnavailableError";
  }
}

const CRM_PUBLIC_INTEGRATION_FIELDS = [
  "id",
  "provider",
  "name",
  "status",
  "created_at",
  "updated_at",
  "last_sync_at",
  "last_sync_status",
  "synced_contacts",
] as const;

function toPublicCrmIntegration(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    CRM_PUBLIC_INTEGRATION_FIELDS
      .filter((field) => row[field] !== undefined)
      .map((field) => [field, row[field]]),
  );
}

export function getCrmLimit(plan: string): number {
  const def = PLAN_DEFINITIONS[plan.toLowerCase()];
  return def ? def.limits.workspaces : 1;
}

export async function getCrmStatus(orgId: string): Promise<{
  integrations: unknown[];
  connected: number;
  stats: Record<string, unknown>;
}> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id, provider, name, status, created_at, updated_at, last_sync_at, last_sync_status, synced_contacts
         FROM crm_integrations
        WHERE org_id=$1
        ORDER BY created_at DESC`,
      [orgId],
    );
    const connected = r.rows.filter((i: { status: string }) => i.status === 'connected').length;
    const statsRes = await client.query(`
      SELECT COUNT(*) total_syncs,
             SUM(records_processed) total_records,
             SUM(records_created) total_created,
             SUM(records_failed) total_failed,
             AVG(duration_ms) avg_duration_ms
      FROM crm_sync_logs WHERE org_id=$1
    `, [orgId]);
    const s = statsRes.rows[0] || {};
    return {
      integrations: r.rows.map((row: Record<string, unknown>) => toPublicCrmIntegration(row)),
      connected,
      stats: {
        totalSyncs: parseInt(s.total_syncs || '0', 10),
        totalRecords: parseInt(s.total_records || '0', 10),
        totalCreated: parseInt(s.total_created || '0', 10),
        totalFailed: parseInt(s.total_failed || '0', 10),
        avgDurationMs: Math.round(parseFloat(s.avg_duration_ms || '0')),
      },
    };
  } finally {
    client.release();
  }
}

export async function disconnectCrm(orgId: string, provider: CrmProvider): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE crm_integrations SET status='disconnected', access_token=null, refresh_token=null, updated_at=now() WHERE org_id=$1 AND provider=$2`, [orgId, provider]);
  } finally {
    client.release();
  }
}

export async function syncCrm(orgId: string, provider: CrmProvider, entityType = 'contacts'): Promise<{
  ok: boolean;
  created: number;
  updated: number;
  failed: number;
  durationMs: number;
}> {
  void orgId;
  void provider;
  void entityType;
  throw new CrmCapabilityUnavailableError();
}

export async function getSyncLogs(orgId: string, limit = 50): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT csl.*, ci.provider, ci.name as integration_name FROM crm_sync_logs csl LEFT JOIN crm_integrations ci ON ci.id=csl.crm_integration_id WHERE csl.org_id=$1 ORDER BY csl.started_at DESC LIMIT $2`, [orgId, limit]);
    return r.rows;
  } finally {
    client.release();
  }
}

export async function getFieldMappings(orgId: string, crmId: string): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM crm_field_mappings WHERE crm_integration_id IN (SELECT id FROM crm_integrations WHERE org_id=$1 AND id=$2)`, [orgId, crmId]);
    return r.rows;
  } finally {
    client.release();
  }
}

export async function upsertFieldMapping(orgId: string, crmId: string, entityType: string, fpField: string, crmField: string): Promise<void> {
  const id = `fm_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const client = await pool.connect();
  try {
    await client.query(`INSERT INTO crm_field_mappings (id,crm_integration_id,entity_type,flowpoint_field,crm_field) SELECT $1,id,$2,$3,$4 FROM crm_integrations WHERE org_id=$5 AND id=$6 ON CONFLICT DO NOTHING`,
      [id, entityType, fpField, crmField, orgId, crmId]);
  } finally {
    client.release();
  }
}
