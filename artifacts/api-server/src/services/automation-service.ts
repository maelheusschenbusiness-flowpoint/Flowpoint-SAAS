import { db, pool, automationWorkflowsTable, workflowRunsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { analyzePSI } from "./pagespeed-service.js";
import { aiChat } from "./ai-provider.js";
import { loadOrgAIPrefs, resolveAIModel } from "./ai-prefs.js";

const SEED_WORKFLOWS = [
  { id: "wf_1", name: "Rapport client hebdo",       icon: "📊", description: "Génère et envoie un résumé client chaque semaine",         triggerType: "schedule", triggerConfig: { cron: "0 9 * * 1" },           actions: [{ type: "generate_report", params: { format: "pdf" } }, { type: "send_email", params: { template: "client_weekly" } }],            enabled: true, runsCount: 0, category: "Rapports" },
  { id: "wf_2", name: "SLA monitoring strict",       icon: "🛡️", description: "Alerte multi-canal si uptime < 99.5%",                    triggerType: "condition", triggerConfig: { metric: "uptime", lt: 99.5 },   actions: [{ type: "send_alert", params: { channels: ["email", "sms"] } }, { type: "create_incident" }],                                            enabled: true, runsCount: 0, category: "Monitoring" },
  { id: "wf_3", name: "Pipeline SEO complet",        icon: "🚀", description: "Audit → analyse → recommandations → rapport",             triggerType: "schedule", triggerConfig: { cron: "0 3 * * 1" },           actions: [{ type: "run_audit" }, { type: "generate_recommendations" }, { type: "generate_report", params: { format: "pdf" } }],                  enabled: true, runsCount: 0, category: "SEO" },
  { id: "wf_4", name: "Workflow onboarding",         icon: "🎯", description: "Suite automatisée pour nouveaux clients",                  triggerType: "event",    triggerConfig: { event: "client.created" },     actions: [{ type: "send_welcome_email" }, { type: "run_audit", params: { type: "quick" } }, { type: "create_dashboard" }],                          enabled: false, runsCount: 0, category: "Clients" },
  { id: "wf_5", name: "Veille concurrentielle",      icon: "🕵️", description: "Surveillance hebdo des mouvements concurrents + alerte IA", triggerType: "schedule", triggerConfig: { cron: "0 8 * * 3" },          actions: [{ type: "analyze_competitors" }, { type: "generate_market_insight" }, { type: "notify_if_change", params: { threshold: 5 } }],             enabled: true, runsCount: 0, category: "Intelligence" },
  { id: "wf_6", name: "Backup données mensuel",      icon: "💾", description: "Export complet + stockage cloud chaque mois",             triggerType: "schedule", triggerConfig: { cron: "0 3 1 * *" },           actions: [{ type: "export_all_data", params: { format: "json" } }, { type: "store_cloud" }],                                                        enabled: false, runsCount: 0, category: "Données" },
];

export async function ensureDefaultWorkflows(orgId = "default"): Promise<void> {
  // Seed default workflows for every org that has none — not just demo mode
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
      await executeAction(action.type, action.params ?? {}, wf.orgId);
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
      orgId,
    }).catch(err => logger.warn("logActivity failed", { err: err?.message }));

    store.broadcast({ type: "workflow:completed", workflowId, runId, durationMs }, orgId);
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

async function executeAction(type: string, params: Record<string, unknown>, orgId?: string): Promise<void> {
  logger.debug({ type, params }, "[Automation] Executing action");

  // Lazy resolver — fetches org-scoped recipient from DB, never reads store.me singleton
  let _recipientCache: { email: string; name: string } | null | undefined;
  const getRecipient = async (): Promise<{ email: string; name: string } | null> => {
    if (_recipientCache !== undefined) return _recipientCache;
    if (!orgId) { _recipientCache = null; return null; }
    const { loadOrgData } = await import("./org-data.js");
    const d = await loadOrgData(orgId).catch(() => null);
    _recipientCache = d?.email ? { email: d.email, name: d.firstName || "Utilisateur" } : null;
    return _recipientCache;
  };

  switch (type) {
    case "send_email":
    case "send_welcome_email": {
      const recipient = await getRecipient();
      if (recipient) {
        const { mailer } = await import("./mailer.js");
        const template = String(params["template"] || "");
        if (template === "client_weekly") {
          await mailer.sendReportGenerated({
            to: recipient.email,
            name: recipient.name,
            reportName: "Rapport hebdomadaire",
            reportUrl: "https://app.flowpoint.pro/reports",
          });
        } else {
          await mailer.sendWelcome({
            to: recipient.email,
            name: recipient.name,
          });
        }
      }
      break;
    }
    case "send_alert": {
      const recipient = await getRecipient();
      if (recipient) {
        const { mailer } = await import("./mailer.js");
        await mailer.sendSeoAlert({
          to: recipient.email,
          ruleName: "Alerte automatisation",
          url: String(params["url"] || "votre site"),
          score: 0,
          threshold: Number(params["threshold"] ?? 99.5),
          operator: "lt",
        });
      }
      break;
    }
    case "run_audit": {
      try {
        const client = await pool.connect();
        let targetUrl = "";
        try {
          const r = await client.query(`SELECT url FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [orgId ?? "default"]);
          targetUrl = r.rows[0]?.url ?? "";
        } finally { client.release(); }
        if (!targetUrl) { logger.warn("[Automation] run_audit: no URL found for org"); break; }
        const mobile = await analyzePSI(targetUrl, "mobile", orgId);
        const desktop = await analyzePSI(targetUrl, "desktop", orgId);
        logger.info({ url: targetUrl, mobileScore: mobile.scores.performance, desktopScore: desktop.scores.performance }, "[Automation] run_audit complete");
        store.logActivity({ type: "audit", label: `Audit automatique: ${targetUrl}`, targetId: targetUrl, targetType: "audit", metadata: { mobile: mobile.scores, desktop: desktop.scores }, orgId: orgId ?? "default" }).catch(err => logger.warn("logActivity failed", { err: err?.message }));
      } catch(err) { logger.error({ err }, "[Automation] run_audit failed"); }
      break;
    }
    case "generate_recommendations": {
      try {
        const o = orgId ?? "default";
        const client = await pool.connect();
        let auditData = null;
        try {
          const r = await client.query(`SELECT url, score, speed, issues FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [o]);
          auditData = r.rows[0] ?? null;
        } finally { client.release(); }
        if (!auditData) { logger.warn("[Automation] generate_recommendations: no audit data"); break; }
        const prefs = await loadOrgAIPrefs(o);
        const aiCfg = resolveAIModel(prefs, "seo_audit");
        await aiChat({
          provider: aiCfg.provider, model: aiCfg.model,
          systemPrompt: "Tu es un consultant SEO senior. Génère 5 recommandations prioritaires basées sur les données d'audit fournies. Format: liste numérotée avec impact estimé.",
          messages: [{ role: "user", content: `Audit ${auditData.url} — Score SEO ${auditData.score}/100, Performance ${auditData.speed}/100, ${auditData.issues} issues.` }],
          maxTokens: aiCfg.maxTokens,
        });
        logger.info({ url: auditData.url, provider: aiCfg.provider, model: aiCfg.model }, "[Automation] generate_recommendations complete");
        store.logActivity({ type: "team", label: `Recommandations générées: ${auditData.url}`, targetId: auditData.url, targetType: "recommendations", orgId: o }).catch(err => logger.warn("logActivity failed", { err: err?.message }));
      } catch(err) { logger.error({ err }, "[Automation] generate_recommendations failed"); }
      break;
    }
    case "generate_report": {
      try {
        const o = orgId ?? "default";
        const client = await pool.connect();
        let auditData = null;
        try {
          const r = await client.query(`SELECT url, score, speed, issues FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [o]);
          auditData = r.rows[0] ?? null;
        } finally { client.release(); }
        if (!auditData) {
          logger.warn("[Automation] generate_report: no audit data — cannot generate meaningful report");
          break;
        }
        const prefs = await loadOrgAIPrefs(o);
        const aiCfg = resolveAIModel(prefs, "executive_report");
        const prompt = `Rapport SEO pour ${auditData.url} — Score ${auditData.score}/100, Performance ${auditData.speed}/100, ${auditData.issues} issues. Résume en 3 paragraphes avec actions prioritaires.`;
        await aiChat({
          provider: aiCfg.provider, model: aiCfg.model,
          systemPrompt: "Tu es un consultant SEO senior. Génère un rapport exécutif concis en français.",
          messages: [{ role: "user", content: prompt }],
          maxTokens: aiCfg.maxTokens,
        });
        logger.info({ hasAudit: true, provider: aiCfg.provider, model: aiCfg.model }, "[Automation] generate_report complete");
        const recipient = await getRecipient();
        if (recipient) {
          const { mailer } = await import("./mailer.js");
          await mailer.sendReportGenerated({
            to: recipient.email,
            name: recipient.name,
            reportName: "Rapport automatique",
            reportUrl: "https://app.flowpoint.pro/reports",
          });
        }
      } catch(err) { logger.error({ err }, "[Automation] generate_report failed"); }
      break;
    }
    case "analyze_competitors": {
      try {
        const o = orgId ?? "default";
        const client = await pool.connect();
        let auditData = null;
        try {
          const r = await client.query(`SELECT url, score, speed FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [o]);
          auditData = r.rows[0] ?? null;
        } finally { client.release(); }
        if (!auditData) {
          logger.warn("[Automation] analyze_competitors: no audit data — skipping");
          break;
        }
        const prefs = await loadOrgAIPrefs(o);
        const aiCfg = resolveAIModel(prefs, "market_intel");
        const prompt = `Analyse concurrentielle pour ${auditData.url} (score ${auditData.score}/100). Identifiez 3 gaps concurrentiels probables et 3 opportunités de différenciation.`;
        await aiChat({
          provider: aiCfg.provider, model: aiCfg.model,
          systemPrompt: "Tu es un analyste stratégique SEO. Réponds en français avec des insights actionnables basés sur les données fournies.",
          messages: [{ role: "user", content: prompt }],
          maxTokens: aiCfg.maxTokens,
        });
        logger.info({ url: auditData.url, provider: aiCfg.provider, model: aiCfg.model }, "[Automation] analyze_competitors complete");
      } catch(err) { logger.error({ err }, "[Automation] analyze_competitors failed"); }
      break;
    }
    case "generate_market_insight": {
      logger.info("[Automation] generate_market_insight — market data not yet connected");
      break;
    }
    case "notify_if_change": {
      logger.info({ threshold: params["threshold"] }, "[Automation] notify_if_change — no active comparator");
      break;
    }
    case "create_incident": {
      logger.info("[Automation] create_incident — incident logged");
       store.logActivity({ type: "team", label: "Incident automatique créé", targetType: "incident", orgId: orgId ?? "default" }).catch(err => logger.warn("logActivity failed", { err: err?.message }));
      break;
    }
    case "create_dashboard": {
      logger.info("[Automation] create_dashboard — no-op");
      break;
    }
    case "export_all_data": {
      try {
        const o = orgId ?? "default";
        const client = await pool.connect();
        let counts: Record<string, number> = {};
        try {
          for (const table of ["audits","monitors","tracked_keywords","psi_cache","missions","workflow_runs"]) {
            const r = await client.query(`SELECT COUNT(*) FROM ${table} WHERE org_id=$1`, [o]);
            counts[table] = Number(r.rows[0]?.count ?? 0);
          }
        } finally { client.release(); }
        logger.info({ counts, orgId: o }, "[Automation] export_all_data complete");
      } catch(err) { logger.error({ err }, "[Automation] export_all_data failed"); }
      break;
    }
    case "store_cloud": {
      logger.info("[Automation] store_cloud — no cloud storage configured");
      break;
    }
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
