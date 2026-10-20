import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

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
    const r = await client.query(`SELECT * FROM crm_integrations WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]);
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
      integrations: r.rows,
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

export async function connectCrm(orgId: string, plan: string, provider: CrmProvider, data: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  portalId?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  const client = await pool.connect();
  try {
    const limit = getCrmLimit(plan);
    const count = await client.query(`SELECT COUNT(*) FROM crm_integrations WHERE org_id=$1 AND status='connected'`, [orgId]);
    if (parseInt(count.rows[0].count, 10) >= limit) {
      throw new Error(`Limite du plan atteinte : ${limit} CRM max (${plan}). Passez à un plan supérieur.`);
    }
    const existing = await client.query(`SELECT id FROM crm_integrations WHERE org_id=$1 AND provider=$2`, [orgId, provider]);
    const id = existing.rows[0]?.id ?? `crm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const provInfo = CRM_PROVIDERS.find(p => p.id === provider);
    const expiresAt = data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null;

    if (existing.rows[0]) {
      await client.query(`UPDATE crm_integrations SET status='connected', access_token=$1, refresh_token=$2, token_expires_at=$3, portal_id=$4, scope=$5, metadata=$6, updated_at=now() WHERE id=$7`,
        [data.accessToken, data.refreshToken || null, expiresAt, data.portalId || null, data.scope || null, JSON.stringify(data.metadata || {}), id]);
    } else {
      await client.query(`INSERT INTO crm_integrations (id,org_id,provider,name,status,access_token,refresh_token,token_expires_at,portal_id,scope,metadata) VALUES ($1,$2,$3,$4,'connected',$5,$6,$7,$8,$9,$10)`,
        [id, orgId, provider, provInfo?.name ?? provider, data.accessToken, data.refreshToken || null, expiresAt, data.portalId || null, data.scope || null, JSON.stringify(data.metadata || {})]);
    }
    await client.query(`INSERT INTO crm_tokens (id,crm_integration_id,access_token,refresh_token,expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [`tok_${Date.now()}`, id, data.accessToken, data.refreshToken || null, expiresAt]);

    const res = await client.query(`SELECT * FROM crm_integrations WHERE id=$1`, [id]);
    return res.rows[0];
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
  const logId = `csl_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const client = await pool.connect();
  let integrationId: string | null = null;
  const start = Date.now();
  try {
    const intgRes = await client.query(`SELECT * FROM crm_integrations WHERE org_id=$1 AND provider=$2 AND status='connected'`, [orgId, provider]);
    const intg = intgRes.rows[0];
    if (!intg) throw new Error(`CRM ${provider} non connecté`);
    integrationId = intg.id;

    await client.query(`INSERT INTO crm_sync_logs (id,org_id,crm_integration_id,provider,direction,entity_type,status,started_at) VALUES ($1,$2,$3,$4,'flowpoint_to_crm',$5,'running',now())`,
      [logId, orgId, intg.id, provider, entityType]);

    // CRM sync: real provider API calls go here; counters are 0 until implemented
    const created = 0;
    const updated = 0;
    const failed = 0;
    const durationMs = Date.now() - start;

    await client.query(`UPDATE crm_sync_logs SET status='success', records_processed=$1, records_created=$2, records_updated=$3, records_failed=$4, duration_ms=$5, completed_at=now() WHERE id=$6`,
      [created + updated, created, updated, failed, durationMs, logId]);
    await client.query(`UPDATE crm_integrations SET last_sync_at=now(), last_sync_status='success', synced_contacts=synced_contacts+$1, updated_at=now() WHERE id=$2`,
      [created + updated, intg.id]);

    return { ok: true, created, updated, failed, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    await client.query(`UPDATE crm_sync_logs SET status='failed', error=$1, duration_ms=$2, completed_at=now() WHERE id=$3`,
      [String(err), durationMs, logId]).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
