import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface FireAlertEventOpts {
  orgId: string;
  ruleId: string;
  ruleName: string;
  type: string;
  metricValue?: number | null;
  threshold?: number | null;
  operator?: string | null;
  severity: string;
  message: string;
  siteUrl: string;
  monitorId?: string;
  dedupeKey?: string;
}

export async function fireAlertEvent(opts: FireAlertEventOpts): Promise<void> {
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const client = await pool.connect();
  try {
    if (opts.dedupeKey) {
      await client.query(
        `INSERT INTO alert_events
           (id, org_id, rule_id, rule_name, type, metric_value, threshold, operator,
            severity, message, site_url, monitor_id, status, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [
          id, opts.orgId, opts.ruleId, opts.ruleName, opts.type,
          opts.metricValue ?? null, opts.threshold ?? null, opts.operator ?? null,
          opts.severity, opts.message, opts.siteUrl, opts.monitorId ?? '',
          opts.dedupeKey,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO alert_events
           (id, org_id, rule_id, rule_name, type, metric_value, threshold, operator,
            severity, message, site_url, monitor_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open')`,
        [
          id, opts.orgId, opts.ruleId, opts.ruleName, opts.type,
          opts.metricValue ?? null, opts.threshold ?? null, opts.operator ?? null,
          opts.severity, opts.message, opts.siteUrl, opts.monitorId ?? '',
        ],
      );
    }
  } catch (err) {
    logger.warn({ err }, "[alert-events] fireAlertEvent failed (non-fatal)");
  } finally {
    client.release();
  }
}

export async function resolveAlertEvents(opts: {
  orgId: string;
  monitorId?: string;
  type?: string;
  ruleId?: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    if (opts.monitorId && opts.type) {
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW()
         WHERE org_id = $1 AND monitor_id = $2 AND type = $3 AND status = 'open'`,
        [opts.orgId, opts.monitorId, opts.type],
      );
    } else if (opts.ruleId) {
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW()
         WHERE org_id = $1 AND rule_id = $2 AND status = 'open'`,
        [opts.orgId, opts.ruleId],
      );
    }
  } catch (err) {
    logger.warn({ err }, "[alert-events] resolveAlertEvents failed (non-fatal)");
  } finally {
    client.release();
  }
}
