import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

export const AWL_WEEKLY_REPORT_SOURCE = "ai_workspace_launch";
export const AWL_WEEKLY_REPORT_CRON = "0 9 * * 1";

export function isAWLReportWorkflow(workflow: {
  triggerConfig?: unknown;
  actions?: unknown;
}): boolean {
  const config = workflow.triggerConfig && typeof workflow.triggerConfig === "object"
    ? workflow.triggerConfig as Record<string, unknown>
    : {};
  if (config["source"] === AWL_WEEKLY_REPORT_SOURCE) return true;
  return Array.isArray(workflow.actions) && workflow.actions.some(action => {
    if (!action || typeof action !== "object") return false;
    const params = (action as Record<string, unknown>)["params"];
    return !!params && typeof params === "object" &&
      (params as Record<string, unknown>)["source"] === AWL_WEEKLY_REPORT_SOURCE;
  });
}

export async function upsertAWLWeeklyReportWorkflow(
  orgId: string,
  sessionId: string,
  profileId: string,
  timezone: string,
  database: Pick<typeof pool, "query" | "connect"> = pool,
): Promise<{ id: string; enabled: true }> {
  const client = await database.connect();
  let txActive = false;
  try {
    await client.query("BEGIN");
    txActive = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`${orgId}:awl-weekly-report:${sessionId}`]);
    const owner = await client.query(
      `SELECT 1 FROM onboarding_sessions s
        JOIN ai_workspace_profiles p ON p.session_id=s.id AND p.org_id=s.org_id
       WHERE s.id=$1 AND s.org_id=$2 AND p.id=$3 LIMIT 1`,
      [sessionId, orgId, profileId],
    );
    if (!owner.rows.length) throw new Error("AWL_SESSION_NOT_FOUND");

    const config = {
      cron: AWL_WEEKLY_REPORT_CRON,
      timezone,
      source: AWL_WEEKLY_REPORT_SOURCE,
      sessionId,
      profileId,
    };
    const actions = [{
      type: "generate_report",
      params: { source: AWL_WEEKLY_REPORT_SOURCE, sessionId, profileId, templateKey: "executive" },
    }];
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM automation_workflows
        WHERE org_id=$1 AND trigger_type='schedule'
          AND trigger_config->>'source'=$2 AND trigger_config->>'sessionId'=$3
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [orgId, AWL_WEEKLY_REPORT_SOURCE, sessionId],
    );
    let workflowId = existing.rows[0]?.id;
    if (workflowId) {
      await client.query(
        `UPDATE automation_workflows
            SET name=$1, description=$2, trigger_config=$3::jsonb, actions=$4::jsonb,
                enabled=true, updated_at=NOW()
          WHERE id=$5 AND org_id=$6`,
        ["Rapport hebdomadaire AI Workspace Launch", "Rapport SEO généré et sauvegardé chaque semaine.", JSON.stringify(config), JSON.stringify(actions), workflowId, orgId],
      );
    } else {
      workflowId = `awl_wf_${randomUUID()}`;
      await client.query(
        `INSERT INTO automation_workflows
           (id, org_id, name, icon, description, trigger_type, trigger_config, actions, enabled, runs_count, category)
         VALUES ($1,$2,$3,'📊',$4,'schedule',$5::jsonb,$6::jsonb,true,0,'Rapports')`,
        [workflowId, orgId, "Rapport hebdomadaire AI Workspace Launch", "Rapport SEO généré et sauvegardé chaque semaine.", JSON.stringify(config), JSON.stringify(actions)],
      );
    }
    const confirmed = await client.query<{ id: string }>(
      `SELECT id FROM automation_workflows
        WHERE id=$1 AND org_id=$2 AND enabled=true AND trigger_type='schedule'
          AND trigger_config->>'source'=$3 AND trigger_config->>'sessionId'=$4
          AND trigger_config->>'cron'=$5 AND trigger_config->>'timezone'=$6`,
      [workflowId, orgId, AWL_WEEKLY_REPORT_SOURCE, sessionId, AWL_WEEKLY_REPORT_CRON, timezone],
    );
    if (!confirmed.rows.length) throw new Error("AWL_WORKFLOW_PERSISTENCE_UNCONFIRMED");
    await client.query("COMMIT");
    txActive = false;
    return { id: workflowId, enabled: true };
  } catch (error) {
    if (txActive) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function disableAWLWeeklyReportWorkflow(
  orgId: string,
  sessionId: string,
  database: Pick<typeof pool, "query" | "connect"> = pool,
): Promise<boolean> {
  const result = await database.query(
    `UPDATE automation_workflows SET enabled=false, updated_at=NOW()
      WHERE org_id=$1 AND trigger_type='schedule' AND enabled=true
        AND trigger_config->>'source'=$2 AND trigger_config->>'sessionId'=$3
      RETURNING id`,
    [orgId, AWL_WEEKLY_REPORT_SOURCE, sessionId],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function hasActiveAWLWeeklyReportWorkflow(
  orgId: string,
  sessionId: string,
  database: Pick<typeof pool, "query" | "connect"> = pool,
): Promise<boolean> {
  const result = await database.query(
    `SELECT 1 FROM automation_workflows
      WHERE org_id=$1 AND trigger_type='schedule' AND enabled=true
        AND trigger_config->>'source'=$2 AND trigger_config->>'sessionId'=$3
      LIMIT 1`,
    [orgId, AWL_WEEKLY_REPORT_SOURCE, sessionId],
  );
  return result.rows.length > 0;
}
