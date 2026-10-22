import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { aiChat } from "../services/ai-provider.js";
import { loadOrgAIPrefs, resolveAIModel } from "../services/ai-prefs.js";
import { checkAIQuota, recordCompletedUsageDeferred, type AIModel } from "../services/ai-engine.js";
import { buildQuotaGuidance } from "../services/ai-quota.js";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { parseWorkspaceLaunchOutput } from "../services/workspace-launch-output.js";
import { hasAddonEntitlementForOrg } from "../services/addon-entitlement.js";
import { disableAWLWeeklyReportWorkflow, hasActiveAWLWeeklyReportWorkflow, upsertAWLWeeklyReportWorkflow } from "../services/awl-weekly-report.js";
import { isValidSchedule } from "../services/workflow-schedule-cron.js";

const router = Router();

router.post("/ai-workspace-launch", requireAddon("aiWorkspaceLaunch", "AI Workspace Launch"), canWrite, async (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ ok: false, code: "INVALID_PROFILE", error: "Un profil workspace valide est requis." });
      return;
    }
    const {
      siteUrl,
      businessName,
      niche,
      location,
      goals = [],
      competitors = [],
      stack = [],
      priorities = [],
      scheduleWeeklyReport = false,
      reportTimezone = "UTC",
    } = req.body as {
      siteUrl?: string;
      businessName?: string;
      niche?: string;
      location?: string;
      goals?: string[];
      competitors?: string[];
      stack?: string[];
      priorities?: string[];
      scheduleWeeklyReport?: boolean;
      reportTimezone?: string;
    };

    const validText = (value: unknown, max: number) =>
      value === undefined || value === null || value === "" || (typeof value === "string" && value.trim().length > 0 && value.length <= max);
    const validList = (value: unknown) =>
      value === undefined || (Array.isArray(value) && value.length <= 12 && value.every((item: unknown) =>
        typeof item === "string" && item.trim().length > 0 && item.length <= 160));
    if (!validText(siteUrl, 500) || !validText(businessName, 160) || !validText(niche, 120) || !validText(location, 120) ||
        typeof scheduleWeeklyReport !== "boolean" || typeof reportTimezone !== "string" || reportTimezone.length > 80 ||
        (scheduleWeeklyReport && !isValidSchedule("0 9 * * 1", reportTimezone)) ||
        !validList(goals) || !validList(competitors) || !validList(stack) || !validList(priorities)) {
      res.status(400).json({ ok: false, code: "INVALID_PROFILE", error: "Le profil contient un champ invalide ou trop long." });
      return;
    }

    const orgId = req.orgId;
    if (!orgId || orgId === "default") {
      res.status(401).json({ ok: false, error: "An authenticated organization is required." });
      return;
    }
    const userId = req.userId ?? "anonymous";
    if (scheduleWeeklyReport) {
      try {
        if (!(await hasAddonEntitlementForOrg(orgId, "aiWorkflows"))) {
          res.status(402).json({ ok: false, code: "ADDON_REQUIRED", addonKey: "aiWorkflows", error: "AI Automation Workflows est requis pour planifier les rapports." });
          return;
        }
      } catch {
        res.status(503).json({ ok: false, code: "ENTITLEMENT_UNAVAILABLE", error: "Impossible de vérifier les droits de planification." });
        return;
      }
    }

    // Read-only quota check before AI work — no DB write until AI succeeds
    const quotaCheck = await checkAIQuota({ feature: "strategist", orgId });
    if (!quotaCheck.allowed) {
      const prefs = await loadOrgAIPrefs(orgId);
      res.status(402).json(buildQuotaGuidance(quotaCheck, prefs));
      return;
    }

    const now = new Date();
    const sessionId = `ows_${randomUUID()}`;
    const profileId = `awp_${randomUUID()}`;
    const dashboardId = `awl_dash_${randomUUID()}`;
    const alertRuleId = `awl_alert_${randomUUID()}`;
    const dashboardName = `${businessName ?? "Workspace"} — lancement IA`;
    const dashboardDescription = "Dashboard configuré depuis les audits et missions réellement enregistrés.";
    const alertName = `Score SEO critique — ${businessName ?? "Workspace"}`;
    const dashboardWidgets = [
      { id: "seo-score", name: "Score SEO", source: "audits", visualization: "metric" },
      { id: "ai-missions", name: "Missions IA", source: "missions", visualization: "list" },
    ];

    const client = await pool.connect();

    const requestId = `req_${randomUUID()}`;
    let roadmap: Array<{ priority: number; label: string; impact: string; tag: string }> = [];
    let missionTemplates: Array<{ title: string; category: string; priority: number; impact: string; effort: string }> = [];
    let strategy = "";
    let aiGenerationSucceeded = false;
    let actualProvider: string = "openai";
    let actualModel: string = "workspace_launch";
    let aiTokensIn = 0;
    let aiTokensOut = 0;
    let aiLatencyMs = 0;
    let persistedRoadmap = roadmap;
    let persistedStrategy = strategy;
    let persistedMissions = missionTemplates;

    try {
      const prefs = await loadOrgAIPrefs(orgId);
      const aiCfg = resolveAIModel(prefs, "strategist");
      actualProvider = aiCfg.provider;
      actualModel    = aiCfg.model;
      const t0 = Date.now();

      const contextParts: string[] = [];
      if (businessName) contextParts.push(`Entreprise : ${businessName}`);
      if (niche) contextParts.push(`Secteur/niche : ${niche}`);
      if (location) contextParts.push(`Localisation : ${location}`);
      if (siteUrl) contextParts.push(`Site web : ${siteUrl}`);
      if (goals.length > 0) contextParts.push(`Objectifs : ${goals.join(", ")}`);
      if (competitors.length > 0) contextParts.push(`Concurrents : ${competitors.join(", ")}`);
      if (stack.length > 0) contextParts.push(`Stack technique : ${stack.join(", ")}`);
      if (priorities.length > 0) contextParts.push(`Priorités déclarées : ${priorities.join(", ")}`);

      const prompt = `Tu es consultant SEO senior. Génère un plan de lancement workspace personnalisé pour ce client.

PROFIL CLIENT :
${contextParts.join("\n")}

Génère un JSON avec EXACTEMENT cette structure (pas de markdown, juste le JSON) :
{
  "strategy": "string (2 phrases sur la stratégie spécifique à ce client)",
  "roadmap": [
    { "priority": 1, "label": "string (action spécifique au secteur)", "impact": "string (ex: +20% trafic local)", "tag": "string" },
    { "priority": 2, "label": "...", "impact": "...", "tag": "..." },
    { "priority": 3, "label": "...", "impact": "...", "tag": "..." },
    { "priority": 4, "label": "...", "impact": "...", "tag": "..." },
    { "priority": 5, "label": "...", "impact": "...", "tag": "..." }
  ],
  "missions": [
    { "title": "string (mission spécifique)", "category": "seo|performance|content|local_seo|conversion|reporting|monitoring|analytics", "priority": 1, "impact": "string", "effort": "string (ex: 2h)" },
    ... (12 missions au total)
  ]
}

RÈGLES IMPORTANTES :
- Chaque action doit être spécifique au secteur "${niche ?? "général"}" et à la localisation "${location ?? "France"}".
- Les missions doivent varier en catégories (SEO, perf, contenu, local, etc.).
- Les impacts doivent être réalistes et quantifiés.
- Réponds UNIQUEMENT avec le JSON, aucun autre texte.`;

      const aiResult = await aiChat({
        provider: aiCfg.provider,
        model: aiCfg.model,
        systemPrompt: "Tu es un expert SEO. Réponds toujours en JSON valide uniquement, sans markdown ni commentaire.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: aiCfg.maxTokens,
        json: true,
      });

      aiTokensIn  = aiResult.usage?.promptTokens    ?? 0;
      aiTokensOut = aiResult.usage?.completionTokens ?? 0;
      const parsed = parseWorkspaceLaunchOutput(aiResult.text ?? "");
      if (!parsed) throw new Error("AI output did not contain a complete, valid workspace plan");
      aiLatencyMs = Date.now() - t0;
      roadmap = parsed.roadmap;
      missionTemplates = parsed.missions;
      strategy = parsed.strategy;
      aiGenerationSucceeded = true;

      // Record usage only when AI actually generated content (not when using fallback)
      if (aiGenerationSucceeded) {
        recordCompletedUsageDeferred({
          feature: "strategist", orgId, userId,
          model: aiCfg.model as AIModel, provider: aiCfg.provider,
          tokensIn: aiTokensIn, tokensOut: aiTokensOut,
          latencyMs: aiLatencyMs, success: true, requestId,
        });
      }

      logger.info({ orgId, provider: aiCfg.provider, model: aiCfg.model, businessName }, "[AWL] AI generation succeeded");
    } catch (aiErr) {
      logger.warn({ aiErr, businessName }, "[AWL] AI generation failed; refusing to persist generic fallback data");
    }

    if (!aiGenerationSucceeded || roadmap.length === 0 || missionTemplates.length === 0 || !strategy.trim()) {
      client.release();
      res.status(502).json({ ok: false, code: "AI_GENERATION_FAILED", error: "Aucune stratégie personnalisée n'a été générée; aucune donnée de démonstration n'a été enregistrée." });
      return;
    }

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO onboarding_sessions (id, org_id, user_id, status, site_url, business_name, niche, location, started_at, completed_at, metadata)
         VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          sessionId,
          orgId,
          userId,
          siteUrl ?? null,
          businessName ?? null,
          niche ?? null,
          location ?? null,
          now,
          now,
           JSON.stringify({
             goals, competitors, stack, priorities, aiGenerated: aiGenerationSucceeded,
             dashboardId, alertRuleId, dashboardsCreated: 1, alertsConfigured: 1,
           }),
        ]
      );

      await client.query(
        `INSERT INTO ai_workspace_profiles (id, org_id, session_id, business_name, niche, location, goals, competitors, stack, priorities, generated_roadmap, generated_strategy, seo_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          profileId,
          orgId,
          sessionId,
          businessName ?? null,
          niche ?? null,
          location ?? null,
          JSON.stringify(goals),
          JSON.stringify(competitors),
          JSON.stringify(stack),
          JSON.stringify(priorities),
          JSON.stringify(roadmap),
          strategy,
          0,
        ]
      );

      for (const m of missionTemplates) {
        const mId = `agm_${sessionId}_${m.priority}`;
        await client.query(
          `INSERT INTO ai_generated_missions (id, org_id, profile_id, title, category, priority, estimated_impact, estimated_effort, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
           ON CONFLICT (id) DO NOTHING`,
          [mId, orgId, profileId, m.title, m.category, m.priority, m.impact, m.effort]
        );
      }

      const logEntries = [
        { step: "init", message: `Session démarrée pour ${businessName ?? "business"} (${niche ?? "secteur"})` },
        { step: "profile", message: "Profil IA workspace créé" },
        { step: "missions", message: `${missionTemplates.length} missions générées par IA` },
        { step: "roadmap", message: `Roadmap personnalisée de ${roadmap.length} étapes générée par IA` },
        { step: "complete", message: "Workspace AI configuré avec succès — stratégie personnalisée" },
      ];
      for (const l of logEntries) {
        await client.query(
          `INSERT INTO ai_setup_logs (id, org_id, session_id, step, message, level)
           VALUES ($1,$2,$3,$4,$5,'info')
           ON CONFLICT (id) DO NOTHING`,
          [`asl_${sessionId}_${l.step}`, orgId, sessionId, l.step, l.message]
        );
      }

      // Turn the generated ideas into actionable, tenant-scoped missions.
      const actionableMissionIds: string[] = [];
      for (const m of missionTemplates) {
        const missionId = `aiw_${requestId}_${m.priority}`;
        const priorityRank = Number(m.priority) || 50;
        const priority = priorityRank <= 2 ? "high" : priorityRank <= 5 ? "medium" : "low";
        await client.query(
          `INSERT INTO missions (id, org_id, title, description, category, type, priority, priority_score, status, impact, effort, source_type, source_data, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'action',$6,$7,'todo',$8,$9,'ai_workspace_launch',$10::jsonb,NOW(),NOW())
           ON CONFLICT (id) DO NOTHING`,
          [missionId, orgId, m.title, strategy, m.category, priority, Math.max(0, 100 - priorityRank * 5), m.impact, m.effort, JSON.stringify({ profileId, sessionId, generatedBy: "AI Workspace Launch" })]
        );
        actionableMissionIds.push(missionId);
      }
      const verifiedMissions = await client.query(
        `SELECT id FROM missions WHERE org_id = $1 AND id = ANY($2::text[])`,
        [orgId, actionableMissionIds]
      );
      if (verifiedMissions.rows.length !== actionableMissionIds.length) {
        throw new Error(`Workspace mission verification failed: expected ${actionableMissionIds.length}, got ${verifiedMissions.rows.length}`);
      }
      await client.query(
        `INSERT INTO custom_dashboards
           (id, org_id, name, description, widgets, icon, color, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,'📊','#6366f1',NOW(),NOW())`,
        [
          dashboardId,
          orgId,
          dashboardName,
          dashboardDescription,
          JSON.stringify(dashboardWidgets),
        ],
      );
      await client.query(
        `INSERT INTO alert_rules
           (id, org_id, name, type, operator, threshold, duration_min, channels, site_urls, enabled)
         VALUES ($1,$2,$3,'seo_score','lt',50,0,'["email"]'::jsonb,$4::jsonb,true)`,
        [alertRuleId, orgId, alertName, JSON.stringify(siteUrl ? [siteUrl] : [])],
      );
      const persistedSetup = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM custom_dashboards WHERE org_id=$1 AND id=$2) AS dashboards,
           (SELECT COUNT(*)::int FROM alert_rules WHERE org_id=$1 AND id=$3) AS alerts`,
        [orgId, dashboardId, alertRuleId],
      );
      if (Number(persistedSetup.rows[0]?.dashboards) !== 1 || Number(persistedSetup.rows[0]?.alerts) !== 1) {
        throw new Error("Workspace dashboard or alert persistence verification failed");
      }
      const persistedProfile = await client.query<{
        generated_roadmap: typeof roadmap;
        generated_strategy: string;
      }>(
        `SELECT generated_roadmap, generated_strategy
           FROM ai_workspace_profiles
          WHERE org_id = $1 AND id = $2 AND session_id = $3`,
        [orgId, profileId, sessionId],
      );
      const storedGeneratedMissions = await client.query<{
        title: string;
        category: string;
        priority: number;
        estimated_impact: string;
        estimated_effort: string;
      }>(
        `SELECT title, category, priority, estimated_impact, estimated_effort
           FROM ai_generated_missions
          WHERE org_id = $1 AND profile_id = $2
          ORDER BY priority ASC`,
        [orgId, profileId],
      );
      if (persistedProfile.rows.length !== 1 ||
          storedGeneratedMissions.rows.length !== missionTemplates.length) {
        throw new Error("Workspace result persistence verification failed");
      }
      persistedRoadmap = persistedProfile.rows[0]!.generated_roadmap;
      persistedStrategy = persistedProfile.rows[0]!.generated_strategy;
      persistedMissions = storedGeneratedMissions.rows.map(mission => ({
        title: mission.title,
        category: mission.category as typeof missionTemplates[number]["category"],
        priority: mission.priority,
        impact: mission.estimated_impact,
        effort: mission.estimated_effort,
      }));
      await client.query("COMMIT");
    } catch (persistErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw persistErr;
    } finally {
      client.release();
    }

    let reportsScheduled = 0;
    let reportScheduleError: string | undefined;
    if (scheduleWeeklyReport) {
      try {
        await upsertAWLWeeklyReportWorkflow(orgId, sessionId, profileId, reportTimezone);
        reportsScheduled = Number(await hasActiveAWLWeeklyReportWorkflow(orgId, sessionId));
      } catch (scheduleErr) {
        logger.error({ err: scheduleErr, orgId, sessionId }, "[AWL] weekly report schedule persistence failed");
        reportScheduleError = "Le workspace est créé, mais le rapport hebdomadaire n’a pas pu être planifié.";
      }
    }

    store.logActivity({
      userId,
      userName: "IA FlowPoint",
      type: "ai",
      label: `AI Workspace Launch configuré pour "${businessName ?? "Workspace"}"`,
      targetId: profileId,
      targetType: "ai_workspace",
      metadata: { niche, location, missionsCount: missionTemplates.length, aiGenerated: aiGenerationSucceeded },
      orgId,
    });

    res.json({
      ok: true,
      sessionId,
      profileId,
      strategy: persistedStrategy,
      roadmap: persistedRoadmap,
      missions: persistedMissions,
      missionsGenerated: persistedMissions.length,
      missionsVerified: persistedMissions.length,
      roadmapSteps: persistedRoadmap.length,
       alertsConfigured: 1,
       dashboardsCreated: 1,
      reportsScheduled,
      ...(reportScheduleError ? { reportScheduleError } : {}),
       dashboard: {
         id: dashboardId, name: dashboardName, description: dashboardDescription,
         widgets: dashboardWidgets, icon: "📊", color: "#6366f1", created_at: now,
       },
       alertRule: {
         id: alertRuleId, name: alertName, type: "seo_score",
         operator: "lt", threshold: 50, duration_min: 0,
         channels: ["email"], site_urls: siteUrl ? [siteUrl] : [], enabled: true,
       },
      aiGenerated: aiGenerationSucceeded,
      message: `Plan de lancement personnalisé généré et missions enregistrées pour ${businessName ?? "votre workspace"}.`,
      _ai: aiGenerationSucceeded ? { provider: actualProvider, model: actualModel } : null,
    });
  } catch (err) {
    logger.error({ err }, "[AWL] Error");
    res.status(500).json({ ok: false, error: "Configuration IA échouée" });
  }
});

router.get("/ai-workspace-launch/:sessionId", requireAddon("aiWorkspaceLaunch", "AI Workspace Launch"), async (req: Request, res: Response) => {
  const { sessionId } = req.params;
    const orgId = req.orgId;

  logger.info({ orgId, sessionId }, "[AWL-GET] incoming request");

  if (!orgId || orgId === "default") {
    logger.warn({ sessionId }, "[AWL-GET] orgId is undefined — rejecting 401");
    return res.status(401).json({ ok: false, error: "Organization context required" });
  }

  const sql = `SELECT s.*, p.id AS profile_id, p.generated_roadmap, p.generated_strategy, p.seo_score,
        (SELECT COUNT(*) FROM ai_generated_missions WHERE org_id = $2 AND profile_id = p.id) as mission_count,
        (SELECT COUNT(*)::int FROM custom_dashboards cd WHERE cd.org_id = s.org_id AND cd.id = s.metadata->>'dashboardId') AS dashboards_created,
        (SELECT COUNT(*)::int FROM alert_rules ar WHERE ar.org_id = s.org_id AND ar.id = s.metadata->>'alertRuleId') AS alerts_configured
       FROM onboarding_sessions s
       LEFT JOIN ai_workspace_profiles p ON p.session_id = s.id AND p.org_id = s.org_id
       WHERE s.id = $1 AND s.org_id = $2`;
  const params = [sessionId, orgId];

  logger.info({ orgId, sessionId, sql: sql.replace(/\s+/g, " ").trim(), params }, "[AWL-GET] executing query");

  const client = await pool.connect();
  try {
    const sess = await client.query(sql, params);

    logger.info({ orgId, sessionId, rowCount: sess.rows.length }, "[AWL-GET] query returned");

    if (sess.rows.length === 0) {
      return res.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
    }
    const session = sess.rows[0];
    const missions = session.profile_id
      ? await client.query(
        `SELECT id, title, category, priority, estimated_impact AS impact,
                estimated_effort AS effort, status
           FROM ai_generated_missions
          WHERE org_id = $1 AND profile_id = $2
          ORDER BY priority ASC`,
        [orgId, session.profile_id],
      )
      : { rows: [] };
    let reportsScheduled = 0;
    try {
      const entitled = await Promise.all([
        hasAddonEntitlementForOrg(orgId, "aiWorkspaceLaunch"),
        hasAddonEntitlementForOrg(orgId, "aiWorkflows"),
      ]);
      if (entitled.every(Boolean)) {
        const scheduled = await client.query(
          `SELECT 1 FROM automation_workflows
            WHERE org_id=$1 AND enabled=true AND trigger_type='schedule'
              AND trigger_config->>'source'='ai_workspace_launch'
              AND trigger_config->>'sessionId'=$2
            LIMIT 1`,
          [orgId, sessionId],
        );
        reportsScheduled = scheduled.rows.length ? 1 : 0;
      }
    } catch (scheduleStatusErr) {
      logger.warn({ err: scheduleStatusErr, orgId, sessionId }, "[AWL-GET] schedule status unavailable; reporting zero");
    }
    return res.json({ ok: true, session, missions: missions.rows, reportsScheduled });
  } catch (err: any) {
    logger.error({
      orgId,
      sessionId,
      pg_code:       err?.code,
      pg_detail:     err?.detail,
      pg_constraint: err?.constraint,
      pg_table:      err?.table,
      pg_column:     err?.column,
      pg_routine:    err?.routine,
      message:       err?.message,
    }, "[AWL-GET] PostgreSQL error");
    return res.status(500).json({ ok: false, code: "DB_ERROR", error: "Workspace session could not be loaded." });
  } finally {
    client.release();
  }
});

router.put(
  "/ai-workspace-launch/:sessionId/report-schedule",
  requireAddon("aiWorkspaceLaunch", "AI Workspace Launch"),
  requireAddon("aiWorkflows", "AI Automation Workflows"),
  canWrite,
  async (req: Request, res: Response) => {
    const orgId = req.orgId;
    const sessionId = String(req.params.sessionId ?? "");
    const timezone = typeof req.body?.timezone === "string" ? req.body.timezone : "UTC";
    if (!orgId || orgId === "default") {
      res.status(401).json({ ok: false, error: "Organization context required" });
      return;
    }
    if (!isValidSchedule("0 9 * * 1", timezone)) {
      res.status(400).json({ ok: false, code: "INVALID_TIMEZONE", error: "Fuseau horaire IANA invalide." });
      return;
    }
    try {
      const entitlement = await Promise.all([
        hasAddonEntitlementForOrg(orgId, "aiWorkspaceLaunch"),
        hasAddonEntitlementForOrg(orgId, "aiWorkflows"),
      ]);
      if (!entitlement.every(Boolean)) {
        res.status(402).json({ ok: false, code: "ADDON_REQUIRED", addonKey: entitlement[0] ? "aiWorkflows" : "aiWorkspaceLaunch" });
        return;
      }
      const session = await pool.query<{ profile_id: string }>(
        `SELECT p.id AS profile_id FROM onboarding_sessions s
          JOIN ai_workspace_profiles p ON p.session_id=s.id AND p.org_id=s.org_id
         WHERE s.id=$1 AND s.org_id=$2 LIMIT 1`,
        [sessionId, orgId],
      );
      if (!session.rows[0]) {
        res.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
        return;
      }
      await upsertAWLWeeklyReportWorkflow(orgId, sessionId, session.rows[0].profile_id, timezone);
      const active = await hasActiveAWLWeeklyReportWorkflow(orgId, sessionId);
      res.json({ ok: true, reportsScheduled: active ? 1 : 0, timezone });
    } catch (err) {
      logger.error({ err, orgId, sessionId }, "[AWL] schedule update failed");
      res.status(503).json({ ok: false, code: "SCHEDULE_UNAVAILABLE", error: "Le rapport hebdomadaire n’a pas pu être enregistré." });
    }
  },
);

router.delete(
  "/ai-workspace-launch/:sessionId/report-schedule",
  requireAddon("aiWorkspaceLaunch", "AI Workspace Launch"),
  requireAddon("aiWorkflows", "AI Automation Workflows"),
  canWrite,
  async (req: Request, res: Response) => {
    const orgId = req.orgId;
    const sessionId = String(req.params.sessionId ?? "");
    if (!orgId || orgId === "default") {
      res.status(401).json({ ok: false, error: "Organization context required" });
      return;
    }
    try {
      const entitlement = await Promise.all([
        hasAddonEntitlementForOrg(orgId, "aiWorkspaceLaunch"),
        hasAddonEntitlementForOrg(orgId, "aiWorkflows"),
      ]);
      if (!entitlement.every(Boolean)) {
        res.status(402).json({ ok: false, code: "ADDON_REQUIRED", addonKey: entitlement[0] ? "aiWorkflows" : "aiWorkspaceLaunch" });
        return;
      }
      const owned = await pool.query(
        `SELECT 1 FROM onboarding_sessions WHERE id=$1 AND org_id=$2 LIMIT 1`,
        [sessionId, orgId],
      );
      if (!owned.rows.length) {
        res.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
        return;
      }
      await disableAWLWeeklyReportWorkflow(orgId, sessionId);
      const active = await hasActiveAWLWeeklyReportWorkflow(orgId, sessionId);
      res.json({ ok: true, reportsScheduled: active ? 1 : 0 });
    } catch (err) {
      logger.error({ err, orgId, sessionId }, "[AWL] schedule disable failed");
      res.status(503).json({ ok: false, code: "SCHEDULE_UNAVAILABLE" });
    }
  },
);

export default router;
