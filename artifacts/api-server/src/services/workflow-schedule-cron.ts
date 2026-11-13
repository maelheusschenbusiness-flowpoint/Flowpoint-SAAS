import { createHash } from "node:crypto";
import cron from "node-cron";
import { pool } from "@workspace/db";
import { PLAN_INCLUDED_ADDONS } from "../lib/plans.js";
import { logger } from "../lib/logger.js";
import { executeWorkflow } from "./automation-service.js";
import { hasAddonEntitlementForOrg } from "./addon-entitlement.js";
import { isAWLReportWorkflow } from "./awl-weekly-report.js";

type WorkflowRow = {
  id: string;
  org_id: string;
  trigger_config: unknown;
};

type ScheduleConfig = { cron?: unknown; timezone?: unknown };
type Queryable = Pick<typeof pool, "query">;
type ScheduledTask = ReturnType<typeof cron.schedule>;

const MAX_SCHEDULED_WORKFLOWS = 1000;
const MAX_RECOVERIES_PER_TICK = 20;
const tasks = new Map<string, { signature: string; task: ScheduledTask }>();
let tickInFlight = false;

export function scheduledWorkflowRunId(orgId: string, workflowId: string, slot: Date): string {
  const minute = Math.floor(slot.getTime() / 60_000);
  const digest = createHash("sha256").update(`${orgId}\0${workflowId}\0${minute}`).digest("hex");
  return `wfs_${digest}`;
}

function parseConfig(value: unknown): ScheduleConfig {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as ScheduleConfig;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ScheduleConfig;
    } catch { /* invalid configuration is rejected by the caller */ }
  }
  return {};
}

export function isValidSchedule(expression: string, timezone: string): boolean {
  if (!cron.validate(expression)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function hasWorkflowEntitlement(orgId: string): Promise<boolean> {
  if (!orgId || orgId === "default") return false;
  const result = await pool.query<{ plan: string | null; addon_active: boolean }>(
    `SELECT
       COALESCE(
         (SELECT LOWER(plan) FROM organizations WHERE id::text=$1 LIMIT 1),
         (SELECT LOWER(plan) FROM org_settings WHERE org_id=$1 LIMIT 1)
       ) AS plan,
       EXISTS (
         SELECT 1 FROM org_addons
          WHERE org_id::text=$1 AND addon_key='aiWorkflows' AND active=true
       ) AS addon_active`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return false;
  return row.addon_active === true || !!PLAN_INCLUDED_ADDONS[row.plan ?? ""]?.has("aiWorkflows");
}

export async function claimScheduledWorkflowRun(
  workflowId: string,
  orgId: string,
  runId: string,
  slot: Date,
  db: Queryable = pool,
  retryFailedAWL = false,
): Promise<boolean> {
  const claim = await db.query(
    `INSERT INTO workflow_runs
       (id, workflow_id, org_id, status, started_at, steps_completed, steps_failed, output)
     VALUES ($1, $2, $3, 'running', NOW(), 0, 0,
       jsonb_build_object('scheduler', jsonb_build_object('slot', $4::text, 'attempt', 1)))
     ON CONFLICT (id) DO UPDATE
       SET status='running', started_at=NOW(), ended_at=NULL, error=NULL,
            steps_failed=CASE WHEN $5::boolean THEN 0 ELSE workflow_runs.steps_failed END,
           output=jsonb_set(
             COALESCE(workflow_runs.output, '{}'::jsonb),
             '{scheduler,attempt}',
             to_jsonb(COALESCE(NULLIF(workflow_runs.output #>> '{scheduler,attempt}', '')::integer, 1) + 1),
             true
           )
     WHERE workflow_runs.workflow_id=EXCLUDED.workflow_id
       AND workflow_runs.org_id=EXCLUDED.org_id
        AND (
          (workflow_runs.status='running' AND workflow_runs.started_at < NOW() - INTERVAL '5 minutes')
          OR ($5::boolean AND workflow_runs.status='failed'
              AND COALESCE(NULLIF(workflow_runs.output #>> '{scheduler,attempt}', '')::integer, 1) < 3)
        )
     RETURNING id`,
    [runId, workflowId, orgId, slot.toISOString(), retryFailedAWL],
  );
  return (claim.rowCount ?? claim.rows.length) > 0;
}

export async function runScheduledWorkflow(
  workflowId: string,
  orgId: string,
  scheduledAt = new Date(),
): Promise<"started" | "duplicate" | "ineligible" | "failed"> {
  if (!workflowId || !orgId || orgId === "default") return "ineligible";
  const slot = new Date(Math.floor(scheduledAt.getTime() / 60_000) * 60_000);
  const runId = scheduledWorkflowRunId(orgId, workflowId, slot);
  try {
    if (!(await hasWorkflowEntitlement(orgId))) return "ineligible";
    const workflow = await pool.query<{ trigger_config: unknown; actions: unknown; enabled: boolean; trigger_type: string }>(
      `SELECT trigger_config, actions, enabled, trigger_type FROM automation_workflows
        WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [workflowId, orgId],
    );
    const row = workflow.rows[0];
    if (!row?.enabled || row.trigger_type !== "schedule") return "ineligible";
    const awlWorkflow = isAWLReportWorkflow({ triggerConfig: row.trigger_config, actions: row.actions });
    if (awlWorkflow && !(await hasAddonEntitlementForOrg(orgId, "aiWorkspaceLaunch"))) return "ineligible";
    if (!(await claimScheduledWorkflowRun(workflowId, orgId, runId, slot, pool, awlWorkflow))) return "duplicate";
    // Keep the existing lease fresh during long-running actions. If this process
    // dies, the lease expires and another instance can reclaim the same run.
    const heartbeat = setInterval(() => {
      void pool.query(
        `UPDATE workflow_runs SET started_at=NOW()
          WHERE id=$1 AND workflow_id=$2 AND org_id=$3 AND status='running'`,
        [runId, workflowId, orgId],
      ).catch(err => logger.warn({ err, workflowId, orgId }, "[workflow-scheduler] lease heartbeat failed"));
    }, 60_000);
    heartbeat.unref?.();
    try {
      const result = await executeWorkflow(workflowId, orgId, { runId, preInserted: true, scheduled: true });
      if (!result.success) logger.warn({ workflowId, orgId, runId, error: result.error }, "[workflow-scheduler] scheduled workflow failed");
    } finally {
      clearInterval(heartbeat);
    }
    return "started";
  } catch (err) {
    logger.warn({ err, workflowId, orgId, runId }, "[workflow-scheduler] scheduled execution failed");
    return "failed";
  }
}

async function recoverInterruptedRuns(): Promise<number> {
  const stale = await pool.query<{
    workflow_id: string;
    org_id: string;
    slot: string;
  }>(
    `SELECT r.workflow_id, r.org_id, r.output #>> '{scheduler,slot}' AS slot
       FROM workflow_runs r
       JOIN automation_workflows w
         ON w.id=r.workflow_id AND w.org_id=r.org_id
       WHERE (
           (r.status='running' AND r.started_at < NOW() - INTERVAL '5 minutes')
           OR (r.status='failed'
               AND w.trigger_config->>'source'='ai_workspace_launch'
               AND COALESCE(NULLIF(r.output #>> '{scheduler,attempt}', '')::integer, 1) < 3)
         )
        AND r.output #>> '{scheduler,slot}' IS NOT NULL
        AND w.enabled=true AND w.trigger_type='schedule'
      ORDER BY r.started_at ASC
      LIMIT $1`,
    [MAX_RECOVERIES_PER_TICK],
  );
  let recovered = 0;
  for (const run of stale.rows) {
    const slot = new Date(run.slot);
    if (!Number.isFinite(slot.getTime()) || !(await hasWorkflowEntitlement(run.org_id))) continue;
    const result = await runScheduledWorkflow(run.workflow_id, run.org_id, slot);
    if (result === "started") recovered++;
  }
  return recovered;
}

export async function runWorkflowSchedulerTick(): Promise<{ synced: number; recovered: number }> {
  if (tickInFlight) return { synced: 0, recovered: 0 };
  tickInFlight = true;
  try {
    const result = await pool.query<WorkflowRow>(
      `SELECT id, org_id, trigger_config FROM automation_workflows
        WHERE enabled=true AND trigger_type='schedule'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT $1`,
      [MAX_SCHEDULED_WORKFLOWS],
    );
    const activeIds = new Set<string>();
    let synced = 0;
    for (const row of result.rows) {
      const orgId = String(row.org_id ?? "");
      if (!orgId || orgId === "default") continue;
      const config = parseConfig(row.trigger_config);
      const expression = typeof config.cron === "string" ? config.cron.trim() : "";
      const timezone = typeof config.timezone === "string" ? config.timezone : "UTC";
      const key = `${orgId}:${row.id}`;
      activeIds.add(key);
      const signature = `${expression}\0${timezone}`;
      const current = tasks.get(key);
      if (current?.signature === signature) continue;
      current?.task.stop();
      current?.task.destroy();
      if (current) synced++;
      if (!expression || !isValidSchedule(expression, timezone)) {
        tasks.delete(key);
        logger.warn({ workflowId: row.id, orgId }, "[workflow-scheduler] invalid cron expression; schedule disabled");
        continue;
      }
      const task = cron.schedule(expression, () => {
        void runScheduledWorkflow(row.id, orgId).catch(err =>
          logger.warn({ err, workflowId: row.id, orgId }, "[workflow-scheduler] task callback failed"));
      }, { timezone, name: `workflow:${row.id}`, noOverlap: true });
      tasks.set(key, { signature, task });
      synced++;
    }
    for (const [key, scheduled] of tasks) {
      if (!activeIds.has(key)) {
        scheduled.task.stop();
        scheduled.task.destroy();
        tasks.delete(key);
        synced++;
      }
    }
    const recovered = await recoverInterruptedRuns();
    return { synced, recovered };
  } finally {
    tickInFlight = false;
  }
}

export function stopWorkflowSchedulerForTests(): void {
  for (const scheduled of tasks.values()) {
    scheduled.task.stop();
    scheduled.task.destroy();
  }
  tasks.clear();
  tickInFlight = false;
}
