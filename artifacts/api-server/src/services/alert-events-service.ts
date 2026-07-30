import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { mailer } from "./mailer.js";

// ── evaluateCondition ─────────────────────────────────────────────────────────
// Centralised threshold comparison used for seo_score, latency, uptime rules.
// Supports all 5 VALID_OPS from alert-rules.ts: lt | lte | gt | gte | eq
// Returns false (never throws) when value or threshold are not finite numbers
// or when operator is not in the allowlist — safe to call in hot paths.

const VALID_EVAL_OPS = new Set(["lt", "lte", "gt", "gte", "eq"]);

export function evaluateCondition(
  value: number,
  operator: string,
  threshold: number,
): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  if (!VALID_EVAL_OPS.has(operator)) return false;
  switch (operator) {
    case "lt":  return value <  threshold;
    case "lte": return value <= threshold;
    case "gt":  return value >  threshold;
    case "gte": return value >= threshold;
    case "eq":  return value === threshold;
    default:    return false;
  }
}

// ── fireAlertEvent ────────────────────────────────────────────────────────────
// Inserts an alert_event row.  When dedupeKey is supplied the INSERT uses
// ON CONFLICT … DO NOTHING against the partial unique index
// alert_events_open_dedupe_key_idx (unique per dedupe_key WHERE status='open').
// This means:
//   • A second call with the same key while the event is still open → no-op.
//   • After the event is resolved (status changed to 'resolved') a future call
//     with the same key creates a fresh open event — enabling new alert cycles.

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
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'open' DO NOTHING`,
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
    // ── Email notification ─────────────────────────────────────────────────────
    // After the DB insert, look up the rule's channels + org owner email.
    // Fire-and-forget: never blocks the alert pipeline.
    try {
      const nr = await client.query<{ channels: string; org_email: string }>(
        `SELECT ar.channels,
                u.email AS org_email
         FROM   alert_rules ar
         JOIN   org_members om ON om.org_id = ar.org_id AND om.role = 'owner'
         JOIN   users       u  ON u.id = om.user_id
         WHERE  ar.id = $1 AND ar.org_id = $2
         LIMIT  1`,
        [opts.ruleId, opts.orgId],
      );
      const row = nr.rows[0];
      if (row?.org_email) {
        let channels: string[] = ["email"];
        try { channels = JSON.parse(String(row.channels)); } catch { /* keep default */ }
        if (channels.includes("email")) {
          mailer.sendAlertRule({
            to:          row.org_email,
            ruleName:    opts.ruleName,
            type:        opts.type,
            metricValue: opts.metricValue,
            threshold:   opts.threshold,
            operator:    opts.operator,
            severity:    opts.severity,
            message:     opts.message,
            siteUrl:     opts.siteUrl,
          }).catch(e => logger.warn({ err: e }, "[alert-events] email notification failed (non-fatal)"));
        }
      }
    } catch (emailErr) {
      logger.warn({ err: emailErr }, "[alert-events] email notification lookup failed (non-fatal)");
    }
  } catch (err) {
    logger.warn({ err }, "[alert-events] fireAlertEvent failed (non-fatal)");
  } finally {
    client.release();
  }
}

// ── resolveAlertEvents ────────────────────────────────────────────────────────
// Resolves (status='resolved', resolved_at=NOW()) open alert_events.
// Three resolution modes (checked in specificity order):
//   1. ruleId + monitorId + type  — per-rule threshold resolution (latency/uptime)
//   2. monitorId + type           — all rules for this monitor+type (monitor_down/up)
//   3. ruleId only                — all events for this rule (seo_score / fallback)

export async function resolveAlertEvents(opts: {
  orgId: string;
  monitorId?: string;
  type?: string;
  ruleId?: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    if (opts.ruleId && opts.monitorId && opts.type) {
      // Most specific: per rule × monitor × type (latency / uptime)
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW()
         WHERE org_id = $1 AND rule_id = $2 AND monitor_id = $3 AND type = $4 AND status = 'open'`,
        [opts.orgId, opts.ruleId, opts.monitorId, opts.type],
      );
    } else if (opts.monitorId && opts.type) {
      // All open events for this monitor × type (monitor_down when monitor comes UP)
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW()
         WHERE org_id = $1 AND monitor_id = $2 AND type = $3 AND status = 'open'`,
        [opts.orgId, opts.monitorId, opts.type],
      );
    } else if (opts.ruleId) {
      // All open events for this rule (seo_score / fallback)
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
