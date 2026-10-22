import { db, pool, automationWorkflowsTable, workflowRunsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { analyzePSI } from "./pagespeed-service.js";
import { aiChat, type AIProviderId } from "./ai-provider.js";
import { loadOrgAIPrefs, resolveAIModel } from "./ai-prefs.js";
import { checkAIQuota, recordCompletedUsage, type AIModel } from "./ai-engine.js";
import { hasAddonEntitlementForOrg } from "./addon-entitlement.js";
import { isAWLReportWorkflow } from "./awl-weekly-report.js";

type WorkflowAIUsage = {
  requestId: string;
  provider: AIProviderId;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
};
type GeneratedWorkflowReport = {
  text?: string;
  _ai?: { provider?: AIProviderId; model?: string };
  usage?: { promptTokens?: number; completionTokens?: number };
};
type ReportWorkflowDependencies = {
  database?: Pick<typeof pool, "query" | "connect">;
  authorizeAWL?: (orgId: string) => Promise<boolean>;
  checkReportsQuota?: (orgId: string) => Promise<boolean>;
  checkAIQuota?: (orgId: string) => Promise<boolean>;
  generate?: (orgId: string, params: Record<string, unknown>, requestId: string) => Promise<GeneratedWorkflowReport>;
  recordUsage?: (orgId: string, usage: WorkflowAIUsage) => Promise<void>;
};

function parseReportUsage(value: unknown): WorkflowAIUsage | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const item = parsed as Partial<WorkflowAIUsage>;
    if (typeof item.requestId !== "string" || typeof item.provider !== "string" ||
        typeof item.model !== "string" || !Number.isFinite(item.tokensIn) ||
        !Number.isFinite(item.tokensOut) || !Number.isFinite(item.latencyMs)) return null;
    return item as WorkflowAIUsage;
  } catch { return null; }
}

async function recordReportAIUsage(orgId: string, usage: WorkflowAIUsage): Promise<void> {
  await recordCompletedUsage({
    feature: "report_gen",
    orgId,
    userId: "system",
    model: usage.model as AIModel,
    provider: usage.provider,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    success: true,
    requestId: usage.requestId,
  });
}

export async function generateAndPersistWorkflowReport(
  orgId: string,
  requestId: string,
  params: Record<string, unknown>,
  dependencies: ReportWorkflowDependencies = {},
): Promise<void> {
  if (!orgId || orgId === "default") throw new Error("Report workflow requires a canonical organization");
  const database = dependencies.database ?? pool;
  const recordUsage = dependencies.recordUsage ?? recordReportAIUsage;
  if (params["source"] === "ai_workspace_launch") {
    const authorized = dependencies.authorizeAWL
      ? await dependencies.authorizeAWL(orgId)
      : await hasAddonEntitlementForOrg(orgId, "aiWorkspaceLaunch") &&
        await hasAddonEntitlementForOrg(orgId, "aiWorkflows");
    if (!authorized) throw new Error("AI_WORKSPACE_LAUNCH_ENTITLEMENT_REQUIRED");
  }
  const reportId = `r_${createHash("sha256").update(`${orgId}\0${requestId}`).digest("hex").slice(0, 32)}`;
  const existing = await database.query<{ generation_metadata_json: string | null }>(
    `SELECT generation_metadata_json FROM reports WHERE id=$1 AND org_id=$2 LIMIT 1`,
    [reportId, orgId],
  );
  if (existing.rows[0]) {
    const savedUsage = parseReportUsage(existing.rows[0].generation_metadata_json);
    if (!savedUsage) throw new Error("Persisted workflow report is missing its usage receipt");
    await recordUsage(orgId, savedUsage);
    return;
  }

  const quotaAllowed = dependencies.checkReportsQuota
    ? await dependencies.checkReportsQuota(orgId)
    : await (async () => {
      const [{ checkQuota }, { resolveQuotaGate }] = await Promise.all([
        import("./billing-service.js"), import("./quota-gate.js"),
      ]);
      const result = await resolveQuotaGate(
        (resource, tenantId) => checkQuota(resource, tenantId, { failClosed: true }),
        "reports",
        orgId,
      );
      if (result.status === "unavailable") throw new Error("REPORT_QUOTA_UNAVAILABLE");
      return result.status === "allowed";
    })();
  if (!quotaAllowed) throw new Error("REPORT_QUOTA_EXCEEDED");

  const auditResult = await database.query<{ id: string; url: string; score: number; speed: number; issues: number }>(
    `SELECT id, url, score, speed, issues FROM audits
      WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [orgId],
  );
  const audit = auditResult.rows[0];
  if (!audit) throw new Error("REPORT_SOURCE_DATA_MISSING");

  const aiAllowed = dependencies.checkAIQuota
    ? await dependencies.checkAIQuota(orgId)
    : (await checkAIQuota({ feature: "report_gen", orgId })).allowed;
  if (!aiAllowed) throw new Error("AI_REPORT_QUOTA_EXCEEDED");
  const startedAt = Date.now();
  const generate = dependencies.generate ?? (async (tenantId, reportParams) => {
    const prefs = await loadOrgAIPrefs(tenantId);
    const aiCfg = resolveAIModel(prefs, "executive_report");
    const result = await aiChat({
      provider: aiCfg.provider,
      model: aiCfg.model,
      systemPrompt: "Tu es un consultant SEO senior. Rédige un rapport hebdomadaire exploitable uniquement à partir des faits mesurés fournis. N'invente aucune donnée, évolution ou causalité. Signale les limites des données.",
      messages: [{
        role: "user",
        content: `Génère un rapport SEO réutilisable pour la semaine se terminant le ${new Date().toISOString().slice(0, 10)}. Inclue une synthèse, les constats mesurés, les priorités de la semaine et les limites. Données du dernier audit enregistré: ${JSON.stringify(audit)}. Contexte AI Workspace Launch: ${JSON.stringify({ sessionId: reportParams["sessionId"] ?? null, profileId: reportParams["profileId"] ?? null })}.`,
      }],
      maxTokens: Math.min(aiCfg.maxTokens, 1200),
    });
    return result;
  });
  const generated = await generate(orgId, params, requestId);
  const reportText = String(generated.text ?? "").trim();
  if (!reportText) throw new Error("REPORT_GENERATION_EMPTY");

  const usage: WorkflowAIUsage = {
    requestId,
    provider: generated._ai?.provider ?? "openai",
    model: generated._ai?.model ?? "gpt-4o-mini",
    tokensIn: generated.usage?.promptTokens ?? 0,
    tokensOut: generated.usage?.completionTokens ?? 0,
    latencyMs: Date.now() - startedAt,
  };
  const createdAt = new Date();
  const end = createdAt.toISOString();
  const start = new Date(createdAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reportName = `Rapport hebdomadaire AI Workspace — ${new Date().toLocaleDateString("fr-BE")}`;
  const notes = JSON.stringify([{
    title: "Synthèse hebdomadaire",
    date: end,
    site: audit.url,
    notes: `${reportText}\n\nDonnées mesurées de l’audit: score SEO ${audit.score}/100, performance ${audit.speed}/100, ${audit.issues} problème(s).`,
  }]);
  const client = await database.connect();
  let txActive = false;
  let inserted = false;
  let savedUsage: WorkflowAIUsage | null = null;
  try {
    await client.query("BEGIN");
    txActive = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`${orgId}:reports`]);
    const current = await client.query<{ generation_metadata_json: string | null }>(
      `SELECT generation_metadata_json FROM reports WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [reportId, orgId],
    );
    if (current.rows[0]) {
      savedUsage = parseReportUsage(current.rows[0].generation_metadata_json);
    } else {
      const freshAllowed = dependencies.checkReportsQuota
        ? await dependencies.checkReportsQuota(orgId)
        : await (async () => {
          const [{ checkQuota }, { resolveQuotaGate }] = await Promise.all([
            import("./billing-service.js"), import("./quota-gate.js"),
          ]);
          const result = await resolveQuotaGate(
            (resource, tenantId) => checkQuota(resource, tenantId, { failClosed: true }),
            "reports",
            orgId,
          );
          if (result.status === "unavailable") throw new Error("REPORT_QUOTA_UNAVAILABLE");
          return result.status === "allowed";
        })();
      if (!freshAllowed) {
        await recordUsage(orgId, usage);
        throw new Error("REPORT_QUOTA_EXCEEDED");
      }
      const insertedResult = await client.query(
        `INSERT INTO reports
           (id, org_id, name, type, template_key, date, pages, shared, audit_id,
            white_label, pdf_ready, meeting_notes_json, generation_metadata_json,
            date_start, date_end, created_by)
         VALUES ($1,$2,$3,'PDF',$4,$5,0,false,$6,false,true,$7,$8,$9,$10,'system')
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [reportId, orgId, reportName, String(params["templateKey"] ?? "executive"), end,
          audit.id, notes, JSON.stringify(usage), start, end],
      );
      inserted = insertedResult.rows.length > 0;
      if (!inserted) {
        const raced = await client.query<{ generation_metadata_json: string | null }>(
          `SELECT generation_metadata_json FROM reports WHERE id=$1 AND org_id=$2 LIMIT 1`,
          [reportId, orgId],
        );
        savedUsage = parseReportUsage(raced.rows[0]?.generation_metadata_json);
      } else savedUsage = usage;
    }
    if (!savedUsage) throw new Error("Persisted workflow report is missing its usage receipt");
    await client.query("COMMIT");
    txActive = false;
  } catch (error) {
    if (txActive) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await recordUsage(orgId, savedUsage);
  if (inserted) {
    import("./usage-events.js").then(m => m.recordUsageEvent(orgId, "report_created")).catch(() => {});
    store.logActivity({
      type: "report",
      label: `Rapport généré : ${reportName}`,
      targetId: reportId,
      targetType: "report",
      metadata: { templateKey: String(params["templateKey"] ?? "executive"), source: "scheduled_workflow" },
      orgId,
      userId: "system",
    }).catch(() => {});
  }
}

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

export type WorkflowExecutionOptions = { runId?: string; preInserted?: boolean; scheduled?: boolean };

async function runWorkflowAI(
  feature: "strategist" | "report_gen" | "market_intel",
  orgId: string,
  requestId: string,
  options: Parameters<typeof aiChat>[0],
): Promise<void> {
  if (!orgId || orgId === "default") throw new Error("AI workflow requires a canonical organization");
  const alreadyRecorded = await pool.query(
    `SELECT 1 FROM ai_usage_logs WHERE org_id=$1::uuid AND idempotency_key=$2 LIMIT 1`,
    [orgId, requestId],
  );
  if (alreadyRecorded.rowCount) return;
  const quota = await checkAIQuota({ feature, orgId });
  if (!quota.allowed) throw new Error(`AI quota exhausted for workflow feature ${feature}`);
  const result = await aiChat(options);
  await recordCompletedUsage({
    feature,
    orgId,
    userId: "system",
    model: result._ai.model as AIModel,
    provider: result._ai.provider,
    tokensIn: result.usage.promptTokens,
    tokensOut: result.usage.completionTokens,
    latencyMs: result.latencyMs,
    success: true,
    requestId,
  });
}

export async function executeWorkflow(
  workflowId: string,
  orgId?: string,
  options: WorkflowExecutionOptions = {},
): Promise<{ success: boolean; runId: string; error?: string }> {
  const runId = options.runId ?? `wr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const workflowScope = orgId
      ? and(eq(automationWorkflowsTable.id, workflowId), eq(automationWorkflowsTable.orgId, orgId))
      : eq(automationWorkflowsTable.id, workflowId);
    const [wf] = await db.select().from(automationWorkflowsTable).where(workflowScope).limit(1);
    if (!wf || !wf.enabled || (orgId && wf.orgId !== orgId) || (options.scheduled && wf.triggerType !== "schedule")) {
      if (options.preInserted && orgId) {
        await pool.query(
          `UPDATE workflow_runs SET status='skipped', ended_at=NOW(), error='Workflow disabled or no longer scheduled'
            WHERE id=$1 AND workflow_id=$2 AND org_id=$3 AND status='running'`,
          [runId, workflowId, orgId],
        );
      }
      return { success: false, runId, error: "Workflow disabled or no longer scheduled" };
    }
    const awlWorkflow = isAWLReportWorkflow({ triggerConfig: wf.triggerConfig, actions: wf.actions });
    const awlEntitlements = awlWorkflow
      ? await Promise.all([
        hasAddonEntitlementForOrg(wf.orgId, "aiWorkspaceLaunch"),
        hasAddonEntitlementForOrg(wf.orgId, "aiWorkflows"),
      ])
      : [true, true];
    if (awlWorkflow && !awlEntitlements.every(Boolean)) {
      if (options.preInserted) {
        await pool.query(
          `UPDATE workflow_runs SET status='skipped', ended_at=NOW(), error='AI Workspace Launch or AI Automation Workflows entitlement unavailable'
            WHERE id=$1 AND workflow_id=$2 AND org_id=$3 AND status='running'`,
          [runId, workflowId, wf.orgId],
        );
      }
      return { success: false, runId, error: "AI Workspace Launch or AI Automation Workflows entitlement unavailable" };
    }
    // Defence in depth: if the caller supplies an org, the workflow must belong to it
    let prior: { rows: Array<{ steps_completed: number; steps_failed: number; error: string | null }> } = {
      rows: [{ steps_completed: 0, steps_failed: 0, error: null }],
    };
    if (options.preInserted) {
      prior = await pool.query<{ steps_completed: number; steps_failed: number; error: string | null }>(
        `SELECT steps_completed, steps_failed, error FROM workflow_runs
          WHERE id=$1 AND workflow_id=$2 AND org_id=$3 AND status='running'`,
        [runId, workflowId, orgId ?? ""],
      );
      if (!prior.rows[0]) return { success: false, runId, error: "Scheduled run claim was lost" };
    } else {
      await db.insert(workflowRunsTable).values({
        id: runId,
        workflowId,
        orgId: wf.orgId ?? orgId ?? "default",
        status: "running",
      });
    }

    const start = Date.now();
    const actions = (wf.actions as Array<{ type: string; params?: Record<string, unknown> }>) ?? [];
    let stepsCompleted = Number(prior.rows[0]?.steps_completed ?? 0);
    let stepsFailed = Number(prior.rows[0]?.steps_failed ?? 0);
    const actionErrors: string[] = prior.rows[0]?.error ? [String(prior.rows[0].error)] : [];
    const nextAction = awlWorkflow
      ? Math.min(actions.length, stepsCompleted)
      : Math.min(actions.length, stepsCompleted + stepsFailed);
    for (let actionIndex = nextAction; actionIndex < actions.length; actionIndex++) {
      const action = actions[actionIndex];
      try {
        await executeAction(action.type, action.params ?? {}, wf.orgId, `workflow:${runId}:${actionIndex}`);
        stepsCompleted++;
      } catch (actionErr) {
        stepsFailed++;
        const msg = actionErr instanceof Error ? actionErr.message : String(actionErr);
        actionErrors.push(`${action?.type ?? "action"}: ${msg}`);
        logger.warn({ err: actionErr, workflowId, actionType: action?.type }, "[Automation] Action failed — continuing with next action");
        if (awlWorkflow) break;
      }
      await pool.query(
        `UPDATE workflow_runs
            SET steps_completed=$1, steps_failed=$2, error=$3
          WHERE id=$4 AND workflow_id=$5 AND org_id=$6 AND status='running'`,
        [stepsCompleted, stepsFailed, actionErrors.length ? actionErrors.join(" | ").slice(0, 2000) : null, runId, workflowId, wf.orgId ?? orgId ?? "default"],
      );
    }

    // Failure semantics: a run with any failed action is NOT a success.
    // All actions are still attempted, but the run is recorded as failed with
    // the real per-action error messages so operational failures stay visible.
    const runFailed = stepsFailed > 0;
    const runStatus = runFailed ? "failed" : "success";
    const runError  = runFailed ? actionErrors.join(" | ").slice(0, 2000) : null;

    const durationMs = Date.now() - start;
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE workflow_runs SET status = $1, ended_at = NOW(), duration_ms = $2, steps_completed = $3, steps_failed = $4, error = $5 WHERE id = $6 AND workflow_id=$7 AND org_id=$8`,
        [runStatus, durationMs, stepsCompleted, stepsFailed, runError, runId, workflowId, wf.orgId ?? orgId ?? "default"]
      );
      await client.query(
        `UPDATE automation_workflows SET runs_count = runs_count + 1, last_run_at = NOW() WHERE id = $1 AND org_id=$2`,
        [workflowId, wf.orgId ?? orgId ?? "default"]
      );
    } finally {
      client.release();
    }

    store.logActivity({
      type: "team",
      label: runFailed
        ? `Workflow en échec partiel : ${wf.name} (${stepsFailed}/${actions.length} action(s) en erreur)`
        : `Workflow exécuté : ${wf.name}`,
      targetId: workflowId,
      targetType: "workflow",
      metadata: { durationMs, stepsCompleted, stepsFailed },
      orgId,
    }).catch(err => logger.warn({ err: err?.message }, "logActivity failed"));

    store.broadcast(
      runFailed
        ? { type: "workflow:failed", workflowId, runId, durationMs, error: runError }
        : { type: "workflow:completed", workflowId, runId, durationMs },
      orgId
    );
    return runFailed
      ? { success: false, runId, error: runError ?? "Une ou plusieurs actions ont échoué" }
      : { success: true, runId };
  } catch (err) {
    logger.error({ err, workflowId }, "[Automation] Workflow execution failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE workflow_runs SET status = 'failed', ended_at = NOW(), error = $1 WHERE id = $2 AND workflow_id=$3 AND org_id=$4`,
        [String(err), runId, workflowId, orgId ?? "default"]
      );
    } finally {
      client.release();
    }
    return { success: false, runId, error: errMsg };
  }
}

async function executeAction(type: string, params: Record<string, unknown>, orgId: string | undefined, requestId: string): Promise<void> {
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
    case "send_email": {
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
        } else logger.warn({ workflowId: undefined, template }, "[Automation] Generic email action has no approved transactional template — skipped");
      }
      break;
    }
    case "send_welcome_email":
      // Welcome is lifecycle-only: it is emitted by successful account
      // activation, never by a replayable automation workflow.
      logger.warn("[Automation] send_welcome_email skipped — welcome emails are activation-only");
      break;
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
        store.logActivity({ type: "audit", label: `Audit automatique: ${targetUrl}`, targetId: targetUrl, targetType: "audit", metadata: { mobile: mobile.scores, desktop: desktop.scores }, orgId: orgId ?? "default" }).catch(err => logger.warn({ err: err?.message }, "logActivity failed"));
      } catch(err) { logger.error({ err }, "[Automation] run_audit failed"); throw err; }
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
        // Detect org language from settings
        let _autoLang = "fr";
        try {
          const _langRow = await pool.query(
            `SELECT settings FROM user_prefs WHERE org_id = $1 LIMIT 1`,
            [o]
          );
          const _settings = _langRow.rows[0]?.settings as Record<string, unknown> | null;
          if (_settings && typeof _settings["language"] === "string") _autoLang = (_settings["language"] as string).slice(0, 2).toLowerCase();
        } catch { /* non-fatal */ }
        const prefs = await loadOrgAIPrefs(o);
        const aiCfg = resolveAIModel(prefs, "seo_audit");
        const _autoSysFr = "Tu es un consultant SEO senior. Génère 5 recommandations prioritaires basées sur les données d'audit fournies. Format: liste numérotée avec impact estimé.";
        const _autoSysEn = "You are a senior SEO consultant. Generate 5 priority recommendations based on the provided audit data. Format: numbered list with estimated impact.";
        const _autoSysDe = "Sie sind ein Senior-SEO-Berater. Erstellen Sie 5 prioritäre Empfehlungen basierend auf den bereitgestellten Audit-Daten. Format: nummerierte Liste mit geschätztem Impact.";
        const _autoSysEs = "Eres un consultor SEO senior. Genera 5 recomendaciones prioritarias basadas en los datos de auditoría proporcionados. Formato: lista numerada con impacto estimado.";
        const _autoSystem = _autoLang === "de" ? _autoSysDe : _autoLang === "es" ? _autoSysEs : _autoLang === "en" ? _autoSysEn : _autoSysFr;
        const _autoUserFr = `Audit ${auditData.url} — Score SEO ${auditData.score}/100, Performance ${auditData.speed}/100, ${auditData.issues} issues.`;
        const _autoUserEn = `Audit ${auditData.url} — SEO score ${auditData.score}/100, Performance ${auditData.speed}/100, ${auditData.issues} issues.`;
        const _autoUser = _autoLang === "en" ? _autoUserEn : _autoLang === "de" ? `Audit ${auditData.url} — SEO-Score ${auditData.score}/100, Performance ${auditData.speed}/100, ${auditData.issues} Issues.` : _autoLang === "es" ? `Auditoría ${auditData.url} — Puntuación SEO ${auditData.score}/100, Rendimiento ${auditData.speed}/100, ${auditData.issues} problemas.` : _autoUserFr;
        logger.info({ userLanguage: _autoLang, aiPromptLanguage: _autoLang, recommendationLanguage: _autoLang }, "[Automation/generate_recommendations] language chain");
        await runWorkflowAI("strategist", o, requestId, {
          provider: aiCfg.provider, model: aiCfg.model,
          systemPrompt: _autoSystem,
          messages: [{ role: "user", content: _autoUser }],
          maxTokens: aiCfg.maxTokens,
        });
        logger.info({ url: auditData.url, provider: aiCfg.provider, model: aiCfg.model }, "[Automation] generate_recommendations complete");
        store.logActivity({ type: "team", label: `Recommandations générées: ${auditData.url}`, targetId: auditData.url, targetType: "recommendations", orgId: o }).catch(err => logger.warn({ err: err?.message }, "logActivity failed"));
      } catch(err) { logger.error({ err }, "[Automation] generate_recommendations failed"); throw err; }
      break;
    }
    case "generate_report": {
      try {
        await generateAndPersistWorkflowReport(orgId ?? "default", requestId, params);
        logger.info({ orgId, requestId }, "[Automation] generate_report persisted");
      } catch(err) { logger.error({ err }, "[Automation] generate_report failed"); throw err; }
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
        await runWorkflowAI("market_intel", o, requestId, {
          provider: aiCfg.provider, model: aiCfg.model,
          systemPrompt: "Tu es un analyste stratégique SEO. Réponds en français avec des insights actionnables basés sur les données fournies.",
          messages: [{ role: "user", content: prompt }],
          maxTokens: aiCfg.maxTokens,
        });
        logger.info({ url: auditData.url, provider: aiCfg.provider, model: aiCfg.model }, "[Automation] analyze_competitors complete");
      } catch(err) { logger.error({ err }, "[Automation] analyze_competitors failed"); throw err; }
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
       store.logActivity({ type: "team", label: "Incident automatique créé", targetType: "incident", orgId: orgId ?? "default" }).catch(err => logger.warn({ err: err?.message }, "logActivity failed"));
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
      } catch(err) { logger.error({ err }, "[Automation] export_all_data failed"); throw err; }
      break;
    }
    case "store_cloud": {
      logger.info("[Automation] store_cloud — no cloud storage configured");
      break;
    }
    default:
      logger.error({ type }, "[Automation] Unknown action type");
      throw new Error(`Type d'action inconnu : ${type}`);
  }
}

export async function getWorkflowsData(orgId = "default"): Promise<{
  workflows: Array<typeof automationWorkflowsTable.$inferSelect>;
  recentRuns: Array<Record<string, unknown>>;
  stats: { active: number; totalRuns: number; successRate: number; timeSavedHours: number };
}> {
  try {
    await ensureDefaultWorkflows(orgId);
    const { pool } = await import("@workspace/db");
    const pgClient = await pool.connect();
    let runs: Array<Record<string, unknown>> = [];
    try {
      const runsRes = await pgClient.query(
        `SELECT id, workflow_id, org_id, status, started_at, ended_at, duration_ms,
                steps_completed, steps_failed, error, output
          FROM workflow_runs WHERE org_id=$1 ORDER BY started_at DESC LIMIT 20`,
        [orgId]
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
