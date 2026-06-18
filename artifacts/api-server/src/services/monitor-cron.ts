import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

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
          await client.query(
            `INSERT INTO notifications (id, type, title, message, read, created_at)
             VALUES ($1,'warning',$2,$3,false,NOW()) ON CONFLICT DO NOTHING`,
            [
              `notif_alert_${Date.now()}`,
              `Alerte SEO : ${rule.name}`,
              `${url} — score ${score}/100 (seuil: ${rule.threshold})`,
            ]
          );
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
