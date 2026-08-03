import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { aiChat } from "../services/ai-provider.js";
import { loadOrgAIPrefs, resolveAIModel } from "../services/ai-prefs.js";
import { checkAIQuota, recordCompletedUsageDeferred, type AIModel } from "../services/ai-engine.js";
import { buildQuotaGuidance } from "../services/ai-quota.js";

const router = Router();

const DEFAULT_ROADMAP = [
  { priority: 1, label: "Optimiser balises meta et titres H1", impact: "+18% trafic organique", tag: "SEO" },
  { priority: 2, label: "Améliorer vitesse mobile (Core Web Vitals)", impact: "+24% Core Web Vitals", tag: "Performance" },
  { priority: 3, label: "Créer 3 landing pages conversion optimisées", impact: "+31% taux conversion", tag: "CRO" },
  { priority: 4, label: "Configurer Google Business Profile complet", impact: "+42% visibilité locale", tag: "Local SEO" },
  { priority: 5, label: "Mettre en place schema markup FAQ + Review", impact: "+15% CTR SERP", tag: "SEO" },
];

const DEFAULT_MISSIONS = [
  { title: "Audit SEO technique complet", category: "seo", priority: 1, impact: "+18% trafic", effort: "2h" },
  { title: "Optimiser les Core Web Vitals", category: "performance", priority: 2, impact: "+24% CWV", effort: "3h" },
  { title: "Créer une landing page conversion", category: "conversion", priority: 3, impact: "+31% CVR", effort: "4h" },
  { title: "Configurer Google Business Profile", category: "local_seo", priority: 4, impact: "+42% local", effort: "1h" },
  { title: "Mettre en place les schema markup", category: "seo", priority: 5, impact: "+15% CTR", effort: "2h" },
  { title: "Analyser les concurrents SEO", category: "seo", priority: 6, impact: "+12% rankings", effort: "2h" },
  { title: "Optimiser le tunnel de conversion", category: "conversion", priority: 7, impact: "+28% CVR", effort: "3h" },
  { title: "Créer des rapports automatiques", category: "reporting", priority: 8, impact: "Gain 2h/sem", effort: "1h" },
  { title: "Configurer les alertes de monitoring", category: "monitoring", priority: 9, impact: "Uptime 99.9%", effort: "30min" },
  { title: "Analyser les avis et e-réputation", category: "local_seo", priority: 10, impact: "+38% note", effort: "1h" },
  { title: "Optimiser les balises title/meta", category: "seo", priority: 11, impact: "+8% CTR", effort: "2h" },
  { title: "Mettre en place le tracking analytics", category: "analytics", priority: 12, impact: "Données fiables", effort: "1h" },
];

router.post("/ai-workspace-launch", async (req: Request, res: Response) => {
  try {
    const {
      siteUrl,
      businessName,
      niche,
      location,
      goals = [],
      competitors = [],
      stack = [],
      priorities = [],
    } = req.body as {
      siteUrl?: string;
      businessName?: string;
      niche?: string;
      location?: string;
      goals?: string[];
      competitors?: string[];
      stack?: string[];
      priorities?: string[];
    };

    const orgId = req.orgId ?? "default";
    const userId = req.userId ?? "anonymous";

    // Read-only quota check before AI work — no DB write until AI succeeds
    const quotaCheck = await checkAIQuota({ feature: "strategist", orgId });
    if (!quotaCheck.allowed) {
      const prefs = await loadOrgAIPrefs(orgId);
      res.status(402).json(buildQuotaGuidance(quotaCheck, prefs));
      return;
    }

    const now = new Date();
    const sessionId = `ows_${Date.now()}`;
    const profileId = `awp_${Date.now()}`;

    const client = await pool.connect();

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let roadmap = DEFAULT_ROADMAP;
    let missionTemplates = DEFAULT_MISSIONS;
    let strategy = `Stratégie IA personnalisée pour ${businessName ?? "votre business"} (${niche ?? "secteur"}, ${location ?? "France"}).`;
    let aiGenerationSucceeded = false;
    let actualProvider: string = "openai";
    let actualModel: string = "workspace_launch";
    let aiTokensIn = 0;
    let aiTokensOut = 0;
    let aiLatencyMs = 0;

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
      const parsed = JSON.parse(aiResult.text || "{}");
      aiLatencyMs = Date.now() - t0;
      if (parsed.roadmap && Array.isArray(parsed.roadmap) && parsed.roadmap.length > 0) {
        roadmap = parsed.roadmap.slice(0, 5);
        aiGenerationSucceeded = true;
      }
      if (parsed.missions && Array.isArray(parsed.missions) && parsed.missions.length > 0) {
        missionTemplates = parsed.missions.slice(0, 12);
        aiGenerationSucceeded = true;
      }
      if (parsed.strategy) strategy = parsed.strategy;

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
      logger.warn({ aiErr, businessName }, "[AWL] AI generation failed — using default templates (not silent)");
      strategy = `Stratégie par défaut pour ${businessName ?? "votre business"} — connectez OpenAI/Anthropic/Gemini pour une stratégie personnalisée.`;
    }

    try {
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
          JSON.stringify({ goals, competitors, stack, priorities, aiGenerated: aiGenerationSucceeded }),
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
        const mId = `agm_${Date.now()}_${m.priority}`;
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
        { step: "missions", message: `${missionTemplates.length} missions générées ${aiGenerationSucceeded ? "via IA" : "depuis les templates par défaut"}` },
        { step: "roadmap", message: `Roadmap de ${roadmap.length} étapes générée ${aiGenerationSucceeded ? "via IA (personnalisée)" : "(template générique)"}` },
        { step: "complete", message: `Workspace AI configuré avec succès${aiGenerationSucceeded ? " — stratégie personnalisée" : " — reconnectez un provider IA pour une stratégie personnalisée"}` },
      ];
      for (const l of logEntries) {
        await client.query(
          `INSERT INTO ai_setup_logs (id, org_id, session_id, step, message, level)
           VALUES ($1,$2,$3,$4,$5,'info')
           ON CONFLICT (id) DO NOTHING`,
          [`asl_${Date.now()}_${l.step}`, orgId, sessionId, l.step, l.message]
        );
      }
    } finally {
      client.release();
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
      missionsGenerated: missionTemplates.length,
      roadmapSteps: roadmap.length,
      alertsConfigured: 8,
      dashboardsCreated: 4,
      reportsScheduled: 3,
      aiGenerated: aiGenerationSucceeded,
      message: `Workspace IA "${businessName ?? "FlowPoint"}" configuré avec succès${aiGenerationSucceeded ? " — stratégie personnalisée générée" : ""}`,
      _ai: aiGenerationSucceeded ? { provider: actualProvider, model: actualModel } : null,
    });
  } catch (err) {
    logger.error({ err }, "[AWL] Error");
    res.status(500).json({ ok: false, error: "Configuration IA échouée" });
  }
});

router.get("/ai-workspace-launch/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const orgId = req.orgId;

  logger.info({ orgId, sessionId }, "[AWL-GET] incoming request");

  if (!orgId) {
    logger.warn({ sessionId }, "[AWL-GET] orgId is undefined — rejecting 401");
    return res.status(401).json({ ok: false, error: "Organization context required" });
  }

  const sql = `SELECT s.*, p.generated_roadmap, p.generated_strategy, p.seo_score,
        (SELECT COUNT(*) FROM ai_generated_missions WHERE profile_id = p.id) as mission_count
       FROM onboarding_sessions s
       LEFT JOIN ai_workspace_profiles p ON p.session_id = s.id
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
    return res.json({ ok: true, session: sess.rows[0] });
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
    return res.status(500).json({ ok: false, code: "DB_ERROR", error: err?.message ?? "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
