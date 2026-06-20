import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { connectMongo } from "../lib/mongo.js";
import { NotificationModel } from "../models/Notification.js";

export async function evaluateAlertRulesForAudit(url: string, score: number): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      // alert_rules still lives in PostgreSQL (auth/config layer) — read from there
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
          // Notifications live in MongoDB (product-data layer)
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
        }
      }
    } finally {
      client.release();
    }
  } catch (err) {
    logger.debug({ err }, "[monitor-cron] evaluateAlertRulesForAudit error (non-fatal)");
  }
}

export function startMonitorCron(): void {
  logger.info("[monitor-cron] Monitor cron started");
}
