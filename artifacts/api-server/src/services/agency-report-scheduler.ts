import cron from "node-cron";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  createAgencyCustomerPortal,
  createConsolidatedAgencyReport,
  getAgencyPublicBaseUrl,
  isAgencyReportDeliveryReady,
} from "./agency-reporting.js";

type ScheduleRow = {
  id: string;
  org_id: string;
  client_name: string;
  recipient_email: string;
  audit_ids: string[] | string;
  cron_expression: string;
  timezone: string;
};

const tasks = new Map<string, { fingerprint: string; task: ReturnType<typeof cron.schedule> }>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshing = false;

async function scopedQuery(orgId: string, sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deliverAgencyReportSchedule(row: ScheduleRow, scheduledAt = new Date()): Promise<void> {
  if (!isAgencyReportDeliveryReady()) throw new Error("AGENCY_SCHEDULER_DISABLED_OR_PUBLIC_URL_MISSING");
  const baseUrl = getAgencyPublicBaseUrl();
  const slot = new Date(scheduledAt);
  slot.setUTCSeconds(0, 0);
  const slotKey = slot.toISOString();
  const runId = `agency_run_${row.id}_${slot.getTime()}`;
  const claim = await scopedQuery(row.org_id,
    `INSERT INTO agency_report_schedule_runs (id, schedule_id, org_id, slot, status)
     VALUES ($1,$2,$3,$4,'running')
     ON CONFLICT (schedule_id, slot) DO NOTHING
     RETURNING id`,
    [runId, row.id, row.org_id, slotKey],
  );
  if (!claim.rows.length) return;
  try {
    const selectedIds = typeof row.audit_ids === "string" ? JSON.parse(row.audit_ids) : row.audit_ids;
    if (!Array.isArray(selectedIds) || selectedIds.length < 2 || !selectedIds.every(id => typeof id === "string")) {
      throw new Error("Invalid selected audit list");
    }
    const report = await createConsolidatedAgencyReport(row.org_id, row.client_name, selectedIds);
    import("./usage-events.js").then(m => m.recordUsageEvent(row.org_id, "report_created")).catch(() => {});
    const portal = await createAgencyCustomerPortal(row.org_id, row.client_name, [report.id], "system");
    const { mailer } = await import("./mailer.js");
    const delivery = await mailer.sendReportGenerated({
      to: row.recipient_email,
      name: row.client_name,
      reportName: report.name,
      reportUrl: `${baseUrl}/api/agency-portal/${encodeURIComponent(portal.token)}`,
    });
    if (!delivery.ok) throw new Error(delivery.error || "Email delivery unavailable");
    await scopedQuery(row.org_id,
      `UPDATE agency_report_schedule_runs SET status='delivered', report_ids=$1::jsonb WHERE id=$2 AND org_id=$3`,
      [JSON.stringify([report.id]), runId, row.org_id],
    );
    await scopedQuery(row.org_id,
      `UPDATE agency_report_schedules SET last_run_at=NOW(), last_status='delivered', last_error=NULL, updated_at=NOW()
        WHERE id=$1 AND org_id=$2`,
      [row.id, row.org_id],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await scopedQuery(row.org_id,
      `UPDATE agency_report_schedule_runs SET status='failed', error=$1 WHERE id=$2 AND org_id=$3`,
      [message.slice(0, 1000), runId, row.org_id],
    ).catch(() => {});
    await scopedQuery(row.org_id,
      `UPDATE agency_report_schedules SET last_run_at=NOW(), last_status='failed', last_error=$1, updated_at=NOW()
        WHERE id=$2 AND org_id=$3`,
      [message.slice(0, 1000), row.id, row.org_id],
    ).catch(() => {});
    logger.warn({ err: error, scheduleId: row.id, orgId: row.org_id }, "[agency-report-scheduler] scheduled report delivery failed");
  }
}

export async function refreshAgencyReportSchedules(): Promise<void> {
  if (refreshing) return;
  if (!isAgencyReportDeliveryReady()) {
    for (const item of tasks.values()) item.task.destroy();
    tasks.clear();
    return;
  }
  refreshing = true;
  try {
    const organizations = await pool.query<{ id: string }>(`SELECT id::text AS id FROM organizations`);
    const rows: ScheduleRow[] = [];
    for (const organization of organizations.rows) {
      const result = await scopedQuery(organization.id,
        `SELECT id, org_id, client_name, recipient_email, audit_ids, cron_expression, timezone
           FROM agency_report_schedules WHERE org_id=$1 AND enabled=true`,
        [organization.id],
      );
      rows.push(...result.rows as ScheduleRow[]);
    }
    const current = new Set<string>();
    for (const row of rows) {
      current.add(row.id);
      const fingerprint = `${row.cron_expression}\0${row.timezone}\0${row.org_id}\0${row.client_name}\0${row.recipient_email}\0${JSON.stringify(row.audit_ids)}`;
      if (tasks.get(row.id)?.fingerprint === fingerprint) continue;
      tasks.get(row.id)?.task.destroy();
      if (!cron.validate(row.cron_expression)) {
        logger.warn({ scheduleId: row.id, orgId: row.org_id }, "[agency-report-scheduler] invalid cron expression");
        continue;
      }
      try {
        const task = cron.schedule(row.cron_expression, () => {
          void deliverAgencyReportSchedule(row).catch(error => logger.warn({ err: error, scheduleId: row.id }, "[agency-report-scheduler] task failed"));
        }, { timezone: row.timezone });
        tasks.set(row.id, { fingerprint, task });
      } catch (error) {
        logger.warn({ err: error, scheduleId: row.id }, "[agency-report-scheduler] invalid timezone or schedule");
      }
    }
    for (const [id, item] of tasks) {
      if (!current.has(id)) {
        item.task.destroy();
        tasks.delete(id);
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "[agency-report-scheduler] schedule refresh failed");
  } finally {
    refreshing = false;
  }
}

export function startAgencyReportScheduler(): void {
  if (refreshTimer || !isAgencyReportDeliveryReady()) return;
  void refreshAgencyReportSchedules();
  refreshTimer = setInterval(() => void refreshAgencyReportSchedules(), 60_000);
}
