/**
 * FlowPoint — Centralized audit trail
 * Writes structured audit events to PostgreSQL asynchronously.
 * Never throws — audit failures must not break the request flow.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger.js";

export type AuditAction =
  | 'auth.login' | 'auth.logout' | 'auth.failed' | 'auth.sso_login'
  | 'plan.upgrade' | 'plan.downgrade' | 'plan.cancelled'
  | 'audit.created' | 'audit.deleted'
  | 'report.generated' | 'report.exported' | 'report.shared'
  | 'team.invited' | 'team.removed' | 'team.role_changed'
  | 'role.created' | 'role.updated' | 'role.deleted'
  | 'sso.provider_added' | 'sso.provider_removed' | 'sso.enforced'
  | 'crm.connected' | 'crm.disconnected' | 'crm.synced'
  | 'monitor.created' | 'monitor.deleted' | 'monitor.alert_fired'
  | 'heatmap.created' | 'heatmap.deleted'
  | 'gbp_post.created' | 'gbp_post.published' | 'gbp_post.deleted'
  | 'automation.created' | 'automation.triggered' | 'automation.deleted'
  | 'webhook.sent' | 'webhook.failed'
  | 'api_key.created' | 'api_key.revoked'
  | 'settings.updated'
  | 'export.created'
  | string;

export interface AuditEvent {
  action:      AuditAction;
  orgId?:      string;
  userId?:     string;
  targetId?:   string;
  targetType?: string;
  ipAddress?:  string;
  userAgent?:  string;
  metadata?:   Record<string, unknown>;
  severity?:   'info' | 'warning' | 'critical';
}

let _dbAvailable = true;

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  // Always log to structured logger
  logger.info({
    audit: true,
    action: event.action,
    orgId:  event.orgId,
    userId: event.userId,
    targetId: event.targetId,
    severity: event.severity ?? 'info',
  }, `[Audit] ${event.action}`);

  if (!_dbAvailable) return;

  // Persist to DB asynchronously — never block the request
  setImmediate(async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) return;
    try {
      const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        `INSERT INTO audit_trail (id, org_id, user_id, action, target_id, target_type, ip_address, user_agent, metadata, severity, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT DO NOTHING`,
        [
          id,
          event.orgId ?? 'default',
          event.userId ?? null,
          event.action,
          event.targetId ?? null,
          event.targetType ?? null,
          event.ipAddress ?? null,
          event.userAgent ?? null,
          event.metadata ? JSON.stringify(event.metadata) : null,
          event.severity ?? 'info',
        ],
      );
    } catch (err: unknown) {
      // If table doesn't exist yet, suppress and disable to avoid log spam
      const msg = String((err as { message?: string })?.message ?? '');
      if (msg.includes('audit_trail')) _dbAvailable = false;
      else logger.debug({ err }, '[Audit] Failed to persist audit event');
    } finally {
      client.release();
    }
  });
}

/** Create audit table if not exists (called during DB init) */
export async function ensureAuditTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id          text PRIMARY KEY,
        org_id      text NOT NULL DEFAULT 'default',
        user_id     text,
        action      text NOT NULL,
        target_id   text,
        target_type text,
        ip_address  text,
        user_agent  text,
        metadata    jsonb,
        severity    text DEFAULT 'info',
        created_at  timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS at_org_idx    ON audit_trail(org_id);
      CREATE INDEX IF NOT EXISTS at_action_idx ON audit_trail(action);
      CREATE INDEX IF NOT EXISTS at_created_idx ON audit_trail(created_at DESC);
    `);
    _dbAvailable = true;
    logger.info('[Audit] audit_trail table ready');
  } finally {
    client.release();
  }
}

/** Convenience wrapper — fire-and-forget */
export function audit(event: AuditEvent): void {
  writeAuditEvent(event).catch(() => {});
}
