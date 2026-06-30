import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { connectMongo } from "../lib/mongo.js";
import { NotificationModel } from "../models/Notification.js";
import { mailer } from "./mailer.js";
import { store } from "./store.js";

// ── SEO Alert evaluation ──────────────────────────────────────────────────────

export async function evaluateAlertRulesForAudit(url: string, score: number): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      const rules = await client.query(
        `SELECT * FROM alert_rules WHERE enabled = true AND type = 'seo_score'`
      );
      for (const rule of rules.rows) {
        let triggered = false;
        if (rule.operator === "lt" && score < rule.threshold) triggered = true;
        if (rule.operator === "gt" && score > rule.threshold) triggered = true;
        if (rule.operator === "eq" && score === rule.threshold) triggered = true;
        if (triggered) {
          logger.info({ url, score, rule: rule.name }, "[monitor-cron] Alert rule triggered");
          try {
            await connectMongo();
            await NotificationModel.create({
              _id: `notif_alert_${Date.now()}`,
              type: "warning",
              title: `Alerte SEO : ${rule.name}`,
              message: `${url} — score ${score}/100 (seuil: ${rule.threshold})`,
              read: false,
            });
          } catch (mongoErr) {
            logger.warn({ err: mongoErr }, "[monitor-cron] Notification write to MongoDB failed");
          }
          const alertEmail = rule.channels?.email || store.me.email;
          if (alertEmail) {
            mailer.sendSeoAlert({
              to: alertEmail,
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
    const { rows } = await client.query<{
      org_id: string;
      email: string;
      first_name: string | null;
      plan: string;
      trial_ends_at: Date;
    }>(`
      SELECT org_id, email, first_name, plan, trial_ends_at
      FROM org_settings
      WHERE subscription_status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at::timestamptz BETWEEN (NOW() + INTERVAL '2 days') AND (NOW() + INTERVAL '4 days')
        AND trial_ending_notified_at IS NULL
        AND email IS NOT NULL
        AND email != ''
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
          await client.query(
            `UPDATE org_settings SET trial_ending_notified_at = NOW() WHERE org_id = $1`,
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

export function startMonitorCron(): void {
  logger.info("[monitor-cron] Monitor cron started");

  // Trial-ending check: run immediately, then every 24 h
  void checkTrialEndingReminders();
  setInterval(() => void checkTrialEndingReminders(), TRIAL_CRON_INTERVAL_MS);
}
