import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { mailer } from "./mailer.js";

// ── SEO Alert evaluation ──────────────────────────────────────────────────────

export async function evaluateAlertRulesForAudit(url: string, score: number, orgId: string): Promise<void> {
  if (!orgId) return; // Never evaluate without org scope — prevents cross-tenant leakage
  try {
    const client = await pool.connect();
    try {
      const rules = await client.query(
        `SELECT ar.*, o.owner_email AS org_email
         FROM alert_rules ar
         LEFT JOIN organizations o ON ar.org_id = o.id
         WHERE ar.enabled = true AND ar.type = 'seo_score' AND ar.org_id = $1`,
        [orgId]
      );
      for (const rule of rules.rows) {
        let triggered = false;
        if (rule.operator === "lt" && score < rule.threshold) triggered = true;
        if (rule.operator === "gt" && score > rule.threshold) triggered = true;
        if (rule.operator === "eq" && score === rule.threshold) triggered = true;
        if (triggered) {
          logger.info({ url, score, rule: rule.name }, "[monitor-cron] Alert rule triggered");
          // BUG-W2-ALT-003: write real alert_event (dedupe by org+rule+day)
          try {
            const { fireAlertEvent } = await import("./alert-events-service.js");
            // dedupeKey is daily — ON CONFLICT targets the open-status partial index
            const dedupeKey = `seo_score_${orgId}_${rule.id}_${new Date().toISOString().slice(0, 10)}`;
            await fireAlertEvent({
              orgId,
              ruleId:      String(rule.id),
              ruleName:    String(rule.name),
              type:        "seo_score",
              metricValue: score,
              threshold:   Number(rule.threshold),
              operator:    String(rule.operator),
              severity:    score < 40 ? "critical" : "warning",
              message:     `${url} — score ${score}/100 (seuil ${rule.operator} ${rule.threshold})`,
              siteUrl:     url,
              dedupeKey,
            });
          } catch (aeErr) {
            logger.warn({ err: aeErr }, "[monitor-cron] alert_event write failed (non-fatal)");
          }
          try {
            const existingNotification = await client.query(
              `SELECT id FROM notifications
               WHERE org_id=$1 AND title=$2 AND message=$3 AND created_at >= NOW() - INTERVAL '1 hour'
               LIMIT 1`,
              [orgId, `Alerte SEO : ${String(rule.name)}`, `${url} — score ${score}/100 (seuil: ${rule.threshold})`],
            );
            if (existingNotification.rows[0]) continue;
            await client.query(
              `INSERT INTO notifications (id, org_id, type, title, message, link, read, created_at)
               VALUES ($1,$2,'warning',$3,$4,$5,false,NOW())`,
              [
                `notif_seo_${Date.now()}_${String(rule.id)}`,
                orgId,
                `Alerte SEO : ${String(rule.name)}`,
                `${url} — score ${score}/100 (seuil: ${rule.threshold})`,
                "/audits",
              ],
            );
          } catch (notificationErr) {
            logger.warn({ err: notificationErr }, "[monitor-cron] PostgreSQL notification write failed");
          }
          const _channels: string[] = (() => { try { const v = typeof rule.channels === "string" ? JSON.parse(rule.channels) : rule.channels; return Array.isArray(v) ? v : ["email"]; } catch { return ["email"]; } })();
          // Recipient: per-rule org owner email from LEFT JOIN organizations.
          // Do NOT use any in-process singleton as a fallback — that causes cross-tenant leakage.
          // If owner_email is NULL (unmigrated org), skip the email rather than send to the wrong address.
          const alertEmail: string | null = _channels.includes("email") ? (rule.org_email || null) : null;
          if (alertEmail) {
            mailer.sendSeoAlert({
              to: String(alertEmail),
              ruleName: String(rule.name),
              url,
              score,
              threshold: Number(rule.threshold),
              operator: String(rule.operator),
            }).catch(() => {});
          }
        }
      }
    } finally {
      client.release();
    }
  } catch (err) {
    logger.debug({ err }, "[monitor-cron] evaluateAlertRulesForAudit error (non-fatal)");
  }
}

// ── Trial-ending reminder (J-3) ───────────────────────────────────────────────
//
// Runs once at startup, then every 24 h.
// Selects orgs where:
//   • subscription_status = 'trialing'         → still on trial
//   • trial_ends_at BETWEEN now+2d AND now+4d  → J-3 window (±1 day tolerance)
//   • trial_ending_notified_at IS NULL          → not yet sent
//   • email IS NOT NULL                         → can receive email
// On success → marks trial_ending_notified_at = NOW() to prevent re-send.

export async function checkTrialEndingReminders(): Promise<void> {
  logger.info("[trial-cron] Running trial-ending reminder check");
  const client = await pool.connect();
  try {
    // Candidates: trialing, J-3 window, not yet notified, has email
    // Jalon 5: read trial candidates from organizations (source of truth for billing state)
    const { rows } = await client.query<{
      org_id: string;
      email: string;
      first_name: string | null;
      plan: string;
      trial_ends_at: Date;
    }>(`
      SELECT id AS org_id, owner_email AS email, owner_first_name AS first_name, plan, trial_ends_at
      FROM organizations
      WHERE subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at BETWEEN (NOW() + INTERVAL '2 days') AND (NOW() + INTERVAL '4 days')
        AND trial_ending_notified_at IS NULL
        AND owner_email IS NOT NULL
        AND owner_email != ''
    `);

    if (rows.length === 0) {
      logger.info("[trial-cron] No trial-ending candidates found");
      return;
    }

    logger.info({ count: rows.length }, "[trial-cron] Trial-ending candidates found");

    for (const row of rows) {
      const msLeft = new Date(row.trial_ends_at).getTime() - Date.now();
      const daysLeft = Math.max(1, Math.round(msLeft / (1000 * 60 * 60 * 24)));

      try {
        const result = await mailer.sendTrialEnding({
          to: row.email,
          name: row.first_name ?? row.email.split("@")[0] ?? "there",
          daysLeft,
          plan: row.plan ?? "standard",
        });

        if (result.ok) {
          // Mark as notified to avoid duplicate sends
          // Jalon 5: mark as notified on organizations (source of truth)
          await client.query(
            `UPDATE organizations SET trial_ending_notified_at = NOW() WHERE id = $1`,
            [row.org_id]
          );
          logger.info(
            { orgId: row.org_id, email: row.email, daysLeft, emailId: result.id },
            "[trial-cron] Trial-ending email sent OK"
          );
        } else {
          logger.warn(
            { orgId: row.org_id, email: row.email, error: result.error },
            "[trial-cron] Trial-ending email FAILED (mailer error)"
          );
        }
      } catch (sendErr) {
        logger.error(
          { orgId: row.org_id, email: row.email, err: sendErr },
          "[trial-cron] Trial-ending email FAILED (unexpected error)"
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "[trial-cron] checkTrialEndingReminders query error (non-fatal) — skipping");
  } finally {
    client.release();
  }
}

// ── Cron scheduler ────────────────────────────────────────────────────────────

const TRIAL_CRON_INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 h
const MONITOR_HEALTH_INTERVAL_MS = 60 * 1000; // check every 1 min which monitors are due

async function runMonitorHealthTick(): Promise<void> {
  const { markCronRun } = await import("../workers/cron-scheduler.js");
  try {
    const { checkAllMonitorsDue } = await import("../routes/monitors.js");
    const { checked, errors } = await checkAllMonitorsDue();
    if (checked > 0) {
      logger.info({ checked, errors }, "[monitor-cron] Background monitor health tick");
    }
    markCronRun("monitor-health", errors > 0 && checked === errors ? "error" : "idle");
  } catch (err) {
    logger.warn({ err }, "[monitor-cron] runMonitorHealthTick failed (non-fatal)");
    markCronRun("monitor-health", "error");
  }
}

export function startMonitorCron(): void {
  logger.info("[monitor-cron] Monitor cron started");

  // Trial-ending check: run immediately, then every 24 h
  void checkTrialEndingReminders();
  setInterval(() => void checkTrialEndingReminders(), TRIAL_CRON_INTERVAL_MS);

  // Monitor health: run immediately, then every minute (each monitor is only
  // actually re-checked once its own `frequency` window has elapsed).
  void runMonitorHealthTick();
  setInterval(() => void runMonitorHealthTick(), MONITOR_HEALTH_INTERVAL_MS);
}
