/**
 * FlowPoint — Scheduled-audit executor (#437)
 *
 * Every minute, launches the audits whose `audit_schedules.next_run` is due,
 * then rolls `next_run` forward (past now) and stamps `last_run`.
 *
 * Column-type tolerance: depending on the deployment, next_run/last_run are
 * either BIGINT epoch-ms (live DBs) or TIMESTAMP (fresh installs from
 * init-data-tables). The mode is detected once from information_schema and
 * values are written in the matching type.
 */

import { pool } from "@workspace/db";
import { computeNextRun, isValidFrequency, type Frequency } from "./schedule-utils.js";
import { launchAudit, findAuditToday, normalizeAuditUrl } from "./audit-runner.js";
import { logger } from "../lib/logger.js";

const MAX_LAUNCHES_PER_TICK = 5;

let inFlight = false;
let numericColumns: boolean | null = null;

export async function detectNumericColumns(): Promise<boolean> {
  if (numericColumns !== null) return numericColumns;
  try {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='audit_schedules' AND column_name='next_run' LIMIT 1`,
    );
    numericColumns = String(r.rows[0]?.data_type ?? "").includes("bigint");
  } catch {
    numericColumns = false;
  }
  return numericColumns;
}

/**
 * Converts a Date to the value that can be bound to audit_schedules.next_run /
 * last_run on THIS deployment (epoch-ms number for BIGINT columns, Date for
 * TIMESTAMP columns). Every write path — cron AND routes — must go through
 * this, otherwise BIGINT deployments reject Date bindings outright.
 */
export async function toScheduleRunValue(d: Date): Promise<number | Date> {
  return (await detectNumericColumns()) ? d.getTime() : d;
}

let createdAtNumeric: boolean | null = null;

/**
 * SQL expression producing "now" in the type of audit_schedules.created_at
 * (BIGINT epoch-ms on live DBs, TIMESTAMP on fresh installs).
 */
export async function scheduleCreatedAtNowSql(): Promise<string> {
  if (createdAtNumeric === null) {
    try {
      const r = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name='audit_schedules' AND column_name='created_at' LIMIT 1`,
      );
      createdAtNumeric = String(r.rows[0]?.data_type ?? "").includes("bigint");
    } catch {
      createdAtNumeric = false;
    }
  }
  return createdAtNumeric ? "(EXTRACT(EPOCH FROM NOW())*1000)::bigint" : "NOW()";
}

function parseRunValue(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return new Date(Number(v));
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

export interface ScheduleTickResult { due: number; launched: number; skippedDuplicates: number }

export async function runScheduledAuditsTick(): Promise<ScheduleTickResult> {
  const result: ScheduleTickResult = { due: 0, launched: 0, skippedDuplicates: 0 };
  if (inFlight) return result;
  inFlight = true;
  try {
    const numeric = await detectNumericColumns();
    // Overdue-first ordering prevents starvation when more than
    // MAX_LAUNCHES_PER_TICK schedules are due at once.
    const r = await pool.query(
      `SELECT id, url, frequency, next_run, org_id FROM audit_schedules
       WHERE enabled = true ORDER BY next_run ASC NULLS LAST LIMIT 500`,
    );
    const now = Date.now();
    const due = r.rows.filter((row: Record<string, unknown>) => {
      const d = parseRunValue(row["next_run"]);
      return d !== null && d.getTime() <= now;
    });
    result.due = due.length;
    if (due.length === 0) return result;

    // Multi-instance safety: the "next_run <= now" predicate on the UPDATE makes
    // the claim atomic — Postgres row-locks serialize concurrent instances, and
    // the loser re-evaluates the predicate against the already-advanced value
    // and matches 0 rows. Claim FIRST, launch only if the claim succeeded.
    const nowPredicate = numeric ? "next_run <= $2" : "next_run <= to_timestamp($2::double precision / 1000)";

    for (const row of due.slice(0, MAX_LAUNCHES_PER_TICK)) {
      const scheduleId = String(row["id"]);
      const orgId = String(row["org_id"] ?? "");
      const freqRaw = String(row["frequency"] || "weekly");
      const freq: Frequency = isValidFrequency(freqRaw) ? freqRaw : "weekly";
      // Roll forward from *now* so a long-overdue schedule fires once, not N times.
      const next = computeNextRun(freq, new Date());
      const nextVal: number | Date = numeric ? next.getTime() : next;
      const lastVal: number | Date = numeric ? now : new Date(now);
      const url = normalizeAuditUrl(row["url"]);

      try {
        // Atomic claim — advances next_run; org_id predicate preserves explicit
        // tenant scoping on the superuser pool.
        const claim = await pool.query(
          `UPDATE audit_schedules SET next_run=$4 WHERE id=$1 AND ${nowPredicate} AND org_id=$3 RETURNING id`,
          [scheduleId, now, orgId, nextVal],
        );
        if (claim.rowCount === 0) continue; // another instance claimed it

        if (!url || !orgId || orgId === "default") {
          // Invalid row — claimed (so it no longer clogs every tick) but never launched.
          logger.warn({ scheduleId, orgId }, "[audit-schedule-cron] skipped invalid schedule row");
          continue;
        }
        const dupId = await findAuditToday(orgId, url);
        if (dupId) {
          // Already audited today (manual run or another schedule) — claim already
          // rolled the schedule forward; do not duplicate the audit.
          result.skippedDuplicates++;
          continue;
        }
        await launchAudit({ orgId, url, origin: "scheduled" });
        await pool.query(
          `UPDATE audit_schedules SET last_run=$1 WHERE id=$2 AND org_id=$3`,
          [lastVal, scheduleId, orgId],
        );
        result.launched++;
        logger.info({ scheduleId, orgId, url, next: next.toISOString() }, "[audit-schedule-cron] scheduled audit launched");
      } catch (err) {
        logger.warn({ err, scheduleId, orgId }, "[audit-schedule-cron] failed to launch scheduled audit");
      }
    }
    return result;
  } finally {
    inFlight = false;
  }
}
