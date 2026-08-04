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
// Runs once at startup, then every 6 h.
// Selects orgs where:
//   • subscription_status = 'trialing'         → still on trial
//   • the UTC calendar end date is exactly three calendar days away
//   • trial_ending_notified_at IS NULL          → not yet sent
//   • email IS NOT NULL                         → can receive email
// An atomic UPDATE claim prevents two app instances from sending the same email.

export async function checkTrialEndingReminders(): Promise<void> {
  logger.info("[trial-cron] Running trial-ending reminder check");
  const client = await pool.connect();
  try {
    // Claim exactly J-3 candidates in one statement. The claim happens BEFORE
    // delivery: a concurrent process cannot duplicate an important reminder.
    // If delivery fails, the claim is cleared below so the next scheduled run
    // can retry.
    const { rows } = await client.query<{
      org_id: string;
      email: string;
      first_name: string | null;
      plan: string;
      trial_ends_at: Date;
    }>(`
      WITH candidates AS (
        SELECT id
        FROM organizations
        WHERE subscription_status = 'trialing'
          AND trial_ends_at IS NOT NULL
          AND (trial_ends_at AT TIME ZONE 'UTC')::date = ((NOW() AT TIME ZONE 'UTC')::date + 3)
          AND trial_ending_notified_at IS NULL
          AND owner_email IS NOT NULL
          AND owner_email != ''
        FOR UPDATE SKIP LOCKED
      )
      UPDATE organizations o
      SET trial_ending_notified_at = NOW()
      FROM candidates c
      WHERE o.id = c.id
      RETURNING o.id AS org_id, o.owner_email AS email, o.owner_first_name AS first_name, o.plan, o.trial_ends_at
    `);

    if (rows.length === 0) {
      logger.info("[trial-cron] No trial-ending candidates found");
      return;
    }

    logger.info({ count: rows.length }, "[trial-cron] Trial-ending candidates found");

    for (const row of rows) {
       const daysLeft = 3;

      try {
        const result = await mailer.sendTrialEnding({
          to: row.email,
          name: row.first_name ?? row.email.split("@")[0] ?? "there",
          daysLeft,
          plan: row.plan ?? "standard",
        });

        if (result.ok) {
          logger.info(
            { orgId: row.org_id, email: row.email, daysLeft, emailId: result.id },
            "[trial-cron] Trial-ending email sent OK"
          );
        } else {
          await client.query(
            `UPDATE organizations SET trial_ending_notified_at = NULL WHERE id = $1`,
            [row.org_id],
          );
          logger.warn(
            { orgId: row.org_id, email: row.email, error: result.error },
            "[trial-cron] Trial-ending email FAILED (mailer error)"
          );
        }
      } catch (sendErr) {
        await client.query(
          `UPDATE organizations SET trial_ending_notified_at = NULL WHERE id = $1`,
          [row.org_id],
        ).catch(() => {});
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

// Provider failures must not make lifecycle onboarding messages disappear
// merely because Stripe has already acknowledged a webhook. Each email has a
// durable claim on organizations; failed sends release that claim for this
// bounded retry pass.
export async function retryLifecycleEmails(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      id: string; owner_email: string; owner_first_name: string | null; plan: string; trial_ends_at: Date | string | null;
      welcome_email_sent_at: Date | null; trial_started_email_sent_at: Date | null;
    }>(`
      SELECT id, owner_email, owner_first_name, plan, trial_ends_at,
             welcome_email_sent_at, trial_started_email_sent_at
      FROM organizations
      WHERE status = 'active' AND owner_email IS NOT NULL AND owner_email != ''
        AND ((welcome_email_eligible_at IS NOT NULL AND welcome_email_sent_at IS NULL)
          OR (subscription_status = 'trialing' AND trial_ends_at IS NOT NULL
              AND trial_started_email_eligible_at IS NOT NULL AND trial_started_email_sent_at IS NULL))
      ORDER BY updated_at ASC LIMIT 50
    `);
    for (const row of rows) {
      const name = row.owner_first_name || row.owner_email.split("@")[0] || "Utilisateur";
      if (!row.welcome_email_sent_at) {
        const claim = await client.query(
          `UPDATE organizations SET welcome_email_claimed_at = NOW()
           WHERE id = $1 AND welcome_email_eligible_at IS NOT NULL
             AND welcome_email_sent_at IS NULL
             AND (welcome_email_claimed_at IS NULL OR welcome_email_claimed_at < NOW() - INTERVAL '15 minutes')
           RETURNING id`,
          [row.id],
        );
        if (claim.rowCount) {
          const result = await mailer.sendWelcome({ to: row.owner_email, name });
          await client.query(
            result.ok
              ? `UPDATE organizations SET welcome_email_sent_at = NOW(), welcome_email_claimed_at = NULL WHERE id = $1`
              : `UPDATE organizations SET welcome_email_claimed_at = NULL WHERE id = $1`,
            [row.id],
          );
        }
      }
      if (!row.trial_started_email_sent_at && row.trial_ends_at) {
        const claim = await client.query(
          `UPDATE organizations SET trial_started_email_claimed_at = NOW()
           WHERE id = $1 AND trial_started_email_eligible_at IS NOT NULL
             AND trial_started_email_sent_at IS NULL
             AND (trial_started_email_claimed_at IS NULL OR trial_started_email_claimed_at < NOW() - INTERVAL '15 minutes')
           RETURNING id`,
          [row.id],
        );
        if (claim.rowCount) {
          const result = await mailer.sendTrialStarted({
            to: row.owner_email, name, plan: row.plan || "standard", trialEndsAt: new Date(row.trial_ends_at).toISOString(),
          });
          await client.query(
            result.ok
              ? `UPDATE organizations SET trial_started_email_sent_at = NOW(), trial_started_email_claimed_at = NULL WHERE id = $1`
              : `UPDATE organizations SET trial_started_email_claimed_at = NULL WHERE id = $1`,
            [row.id],
          );
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "[lifecycle-email-cron] Retry pass failed");
  } finally {
    client.release();
  }
}

// ── Cron scheduler ────────────────────────────────────────────────────────────

// ── Calendar event reminders ──────────────────────────────────────────────────
//
// Runs every minute. Selects calendar_events where reminder > 0 and the
// notification window has opened (event_time - reminder minutes <= NOW()),
// but the event hasn't passed more than 1 hour ago (avoids spamming stale events).
// Notifications are deduplicated via a deterministic id that encodes both the
// event id AND the minute-precision epoch of when the reminder fires:
//   `cal_${event.id}_${reminderMinuteEpoch}`
// This means a rescheduled event (new date/time or new reminder offset) gets a
// fresh notification ID and will fire again, while an unchanged event that has
// already notified is suppressed by ON CONFLICT DO NOTHING.

export async function checkCalendarReminders(): Promise<void> {
  const client = await pool.connect();
  try {
    // Build an event datetime from the TEXT `date` (ISO date) and TEXT `start_time` (HH:MM or HH:MM:SS).
    // When start_time is empty/null we default to 09:00 for the reminder window check.
    const { rows } = await client.query<{
      id: string;
      title: string;
      org_id: string;
      reminder: number;
      event_ts: Date;
    }>(`
      SELECT
        id,
        title,
        org_id,
        reminder,
        (
          (date::DATE)
          + COALESCE(
              NULLIF(start_time, '')::TIME,
              '09:00:00'::TIME
            )
          - (reminder * INTERVAL '1 minute')
        ) AS event_ts
      FROM calendar_events
      WHERE reminder > 0
        AND date IS NOT NULL
        AND date != ''
    `);

    const due = rows.filter(r => {
      const ts = new Date(r.event_ts).getTime();
      const now = Date.now();
      // Window: reminder fired (ts <= now) but event was at most 1h in the past
      return ts <= now && ts >= now - 60 * 60 * 1000;
    });

    if (due.length === 0) return;

    logger.info({ count: due.length }, "[calendar-cron] Calendar reminders due");

    for (const row of due) {
      // Encode the reminder-fire instant at minute precision so that rescheduling
      // the event (changing date, start_time, or reminder offset) produces a new
      // ID and allows the notification to fire again.
      const reminderMinuteEpoch = Math.floor(new Date(row.event_ts).getTime() / 60_000);
      const notifId = `cal_${row.id}_${reminderMinuteEpoch}`;
      // Idempotent insert — skip if this exact reminder instant was already sent
      await client.query(
        `INSERT INTO notifications (id, org_id, type, title, message, link, read, created_at)
         VALUES ($1, $2, 'calendar_reminder', $3, $4, '/calendar', false, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          notifId,
          row.org_id,
          `Rappel : ${row.title}`,
          `Votre événement « ${row.title} » commence dans ${row.reminder} minute${row.reminder > 1 ? 's' : ''}.`,
        ]
      );
    }
  } catch (err) {
    logger.warn({ err }, "[calendar-cron] checkCalendarReminders error (non-fatal)");
  } finally {
    client.release();
  }
}

const TRIAL_CRON_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 h, exact J-3 claim
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

  // Trial-ending check: run immediately, then every 6 h
  void checkTrialEndingReminders();
  setInterval(() => void checkTrialEndingReminders(), TRIAL_CRON_INTERVAL_MS);
  void retryLifecycleEmails();
  setInterval(() => void retryLifecycleEmails(), TRIAL_CRON_INTERVAL_MS);

  // Monitor health: run immediately, then every minute (each monitor is only
  // actually re-checked once its own `frequency` window has elapsed).
  void runMonitorHealthTick();
  setInterval(() => void runMonitorHealthTick(), MONITOR_HEALTH_INTERVAL_MS);

  // Calendar reminders: check every minute for events whose reminder window has opened.
  void checkCalendarReminders();
  setInterval(() => void checkCalendarReminders(), MONITOR_HEALTH_INTERVAL_MS);

  // Scheduled audits: launch due audit_schedules rows every minute (#437).
  void runScheduledAuditsTickSafe();
  setInterval(() => void runScheduledAuditsTickSafe(), MONITOR_HEALTH_INTERVAL_MS);
}

async function runScheduledAuditsTickSafe(): Promise<void> {
  const { markCronRun } = await import("../workers/cron-scheduler.js");
  try {
    const { runScheduledAuditsTick } = await import("./audit-schedule-cron.js");
    const { due, launched, skippedDuplicates } = await runScheduledAuditsTick();
    if (due > 0) {
      logger.info({ due, launched, skippedDuplicates }, "[monitor-cron] scheduled audits tick");
    }
    markCronRun("audit-scheduler", "idle");
  } catch (err) {
    logger.warn({ err }, "[monitor-cron] runScheduledAuditsTickSafe failed (non-fatal)");
    markCronRun("audit-scheduler", "error");
  }
}
