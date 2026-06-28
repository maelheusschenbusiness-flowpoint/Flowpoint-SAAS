import { db, automationWorkflowsTable, workflowRunsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { isDemoMode } from "./mock-data.js";

const SEED_WORKFLOWS = [
  { id: "wf_1", name: "Rapport client hebdo",       icon: "📊", description: "Génère et envoie un résumé client chaque semaine",         triggerType: "schedule", triggerConfig: { cron: "0 9 * * 1" },           actions: [{ type: "generate_report", params: { format: "pdf" } }, { type: "send_email", params: { template: "client_weekly" } }],            enabled: true, runsCount: 0, category: "Rapports" },
  { id: "wf_2", name: "SLA monitoring strict",       icon: "🛡️", description: "Alerte multi-canal si uptime < 99.5%",                    triggerType: "condition", triggerConfig: { metric: "uptime", lt: 99.5 },   actions: [{ type: "send_alert", params: { channels: ["email", "sms"] } }, { type: "create_incident" }],                                            enabled: true, runsCount: 0, category: "Monitoring" },
  { id: "wf_3", name: "Pipeline SEO complet",        icon: "🚀", description: "Audit → analyse → recommandations → rapport",             triggerType: "schedule", triggerConfig: { cron: "0 3 * * 1" },           actions: [{ type: "run_audit" }, { type: "generate_recommendations" }, { type: "generate_report", params: { format: "pdf" } }],                  enabled: true, runsCount: 0, category: "SEO" },
  { id: "wf_4", name: "Workflow onboarding",         icon: "🎯", description: "Suite automatisée pour nouveaux clients",                  triggerType: "event",    triggerConfig: { event: "client.created" },     actions: [{ type: "send_welcome_email" }, { type: "run_audit", params: { type: "quick" } }, { type: "create_dashboard" }],                          enabled: false, runsCount: 0, category: "Clients" },
  { id: "wf_5", name: "Veille concurrentielle",      icon: "🕵️", description: "Surveillance hebdo des mouvements concurrents + alerte IA", triggerType: "schedule", triggerConfig: { cron: "0 8 * * 3" },          actions: [{ type: "analyze_competitors" }, { type: "generate_market_insight" }, { type: "notify_if_change", params: { threshold: 5 } }],             enabled: true, runsCount: 0, category: "Intelligence" },
  { id: "wf_6", name: "Backup données mensuel",      icon: "💾", description: "Export complet + stockage cloud chaque mois",             triggerType: "schedule", triggerConfig: { cron: "0 3 1 * *" },           actions: [{ type: "export_all_data", params: { format: "json" } }, { type: "store_cloud" }],                                                        enabled: false, runsCount: 0, category: "Données" },
];

export async function ensureDefaultWorkflows(orgId = "default"): Promise<void> {
  if (!isDemoMode()) return; // never inject seed workflows in production
  try {
    const existing = await db.select().from(automationWorkflowsTable)
      .where(eq(automationWorkflowsTable.orgId, orgId)).limit(1);
    if (existing.length > 0) return;

    await db.insert(automationWorkflowsTable).values(
      SEED_WORKFLOWS.map(w => ({ ...w, orgId, runsCount: 0 }))
    ).onConflictDoNothing();
  } catch (err) {
    logger.error({ err }, "[Automation] Failed to seed workflows");
  }
}

export async function executeWorkflow(workflowId: string): Promise<{ success: boolean; runId: string }> {
  const runId = `wr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const [wf] = await db.select().from(automationWorkflowsTable).where(eq(automationWorkflowsTable.id, workflowId)).limit(1);
    if (!wf || !wf.enabled) return { success: false, runId };

    await db.insert(workflowRunsTable).values({
      id: runId,
      workflowId,
      status: "running",
    });

    const start = Date.now();
    let stepsCompleted = 0;
    const actions = (wf.actions as Array<{ type: string; params?: Record<string, unknown> }>) ?? [];

    for (const action of actions) {
      await executeAction(action.type, action.params ?? {});
      stepsCompleted++;
    }

    const durationMs = Date.now() - start;
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE workflow_runs SET status = 'success', ended_at = NOW(), duration_ms = $1, steps_completed = $2 WHERE id = $3`,
        [durationMs, stepsCompleted, runId]
      );
      await client.query(
        `UPDATE automation_workflows SET runs_count = runs_count + 1, last_run_at = NOW() WHERE id = $1`,
        [workflowId]
      );
    } finally {
      client.release();
    }

    store.logActivity({
      type: "team",
      label: `Workflow exécuté : ${wf.name}`,
      targetId: workflowId,
      targetType: "workflow",
      metadata: { durationMs, stepsCompleted },
    }).catch(() => {});

    store.broadcast({ type: "workflow:completed", workflowId, runId, durationMs });
    return { success: true, runId };
  } catch (err) {
    logger.error({ err, workflowId }, "[Automation] Workflow execution failed");
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE workflow_runs SET status = 'failed', ended_at = NOW(), error = $1 WHERE id = $2`,
        [String(err), runId]
      );
    } finally {
      client.release();
    }
    return { success: false, runId };
  }
}

async function executeAction(type: string, params: Record<string, unknown>): Promise<void> {
  logger.debug({ type, params }, "[Automation] Executing action");
  switch (type) {
    case "send_email":
    case "send_welcome_email": {
      if (store.me.email) {
        const { mailer } = await import("./mailer.js");
        const template = String(params["template"] || "");
        if (template === "client_weekly") {
          await mailer.sendReportGenerated({
            to: store.me.email as string,
            name: (store.me.firstName || store.me.name || "Utilisateur") as string,
            reportName: "Rapport hebdomadaire",
            reportUrl: "https://app.flowpoint.pro/reports",
          });
        } else {
          await mailer.sendWelcome({
            to: store.me.email as string,
            name: (store.me.firstName || store.me.name || "Utilisateur") as string,
          });
        }
      }
      break;
    }
    case "send_alert": {
      if (store.me.email) {
        const { mailer } = await import("./mailer.js");
        await mailer.sendSeoAlert({
          to: store.me.email as string,
          ruleName: "Alerte automatisation",
          url: (store.me as Record<string, unknown>)["primarySite"] as string || "votre site",
          score: 0,
          threshold: Number(params["threshold"] ?? 99.5),
          operator: "lt",
        });
      }
      break;
    }
    case "run_audit": {
      logger.info("[Automation] run_audit action — triggering audit engine");
      break;
    }
    case "generate_report": {
      logger.info({ format: params["format"] }, "[Automation] generate_report action");
      break;
    }
    case "generate_recommendations":
    case "generate_market_insight":
    case "analyze_competitors":
    case "notify_if_change":
    case "create_incident":
    case "create_dashboard":
    case "export_all_data":
    case "store_cloud":
    default:
      logger.info({ type }, "[Automation] Action logged (no handler)");
  }
}

export async function getWorkflowsData(orgId = "default"): Promise<{
  workflows: Array<typeof automationWorkflowsTable.$inferSelect>;
  recentRuns: Array<typeof workflowRunsTable.$inferSelect>;
  stats: { active: number; totalRuns: number; successRate: number; timeSavedHours: number };
}> {
  try {
    await ensureDefaultWorkflows(orgId);
    const { pool } = await import("@workspace/db");
    const pgClient = await pool.connect();
    let runs: Array<Record<string, unknown>> = [];
    try {
      const runsRes = await pgClient.query(
        `SELECT id, workflow_id, status, started_at, ended_at, duration_ms,
                steps_completed, steps_failed, error, output
         FROM workflow_runs ORDER BY started_at DESC LIMIT 20`
      );
      runs = runsRes.rows;
    } finally {
      pgClient.release();
    }
    const [workflows] = await Promise.all([
      db.select().from(automationWorkflowsTable).where(eq(automationWorkflowsTable.orgId, orgId)).orderBy(desc(automationWorkflowsTable.createdAt)),
    ]);

    const active = workflows.filter(w => w.enabled).length;
    const totalRuns = workflows.reduce((s, w) => s + (w.runsCount ?? 0), 0);
    const successRuns = runs.filter(r => r.status === "success").length;
    const successRate = runs.length > 0 ? Math.round((successRuns / runs.length) * 100) : 0;
    const timeSavedHours = Math.round(totalRuns * 0.4 * 10) / 10;

    return { workflows, recentRuns: runs, stats: { active, totalRuns, successRate, timeSavedHours } };
  } catch (err) {
    logger.error({ err }, "[Automation] getWorkflowsData failed");
    return {
      workflows: [],
      recentRuns: [],
      stats: { active: 0, totalRuns: 0, successRate: 0, timeSavedHours: 0 },
    };
  }
}
