import { Router, type Request, type Response } from "express";
import { pool, db, auditsTable, monitorsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { aiRateLimit } from "../middlewares/rateLimiter.js";
import {
  consumeAICredits,
  checkAIQuota,
  getAIUsageStats,
  getOrCreateMonthlyUsage,
  recordCompletedUsage,
  type AIFeature,
  type AIModel,
} from "../services/ai-engine.js";
import {
  loadOrgAIPrefs,
  checkModuleEnabled,
  moduleDisabledResponse,
  selectOptimalModel,
  resolveAIModel,
  type AIModuleKey,
  type OrgAIPrefs,
} from "../services/ai-prefs.js";
import { aiChat, aiStream, checkAllProviders, type AIProviderId } from "../services/ai-provider.js";
import { buildQuotaGuidance } from "../services/ai-quota.js";
import { resolveIntensityConfig, isValidProvider, isModelValidForProvider, type AIIntensityMode } from "../services/ai-provider-matrix.js";
import {
  computeEconomyTier,
  resolveEconomyPolicy,
  loadOrgEconomyThresholds,
  computeContextLimits,
  type EconomyTier,
} from "../services/ai-economy.js";
import {
  validateAttachmentReferences,
  resolveAIAttachments,
  validateResolvedAttachments,
  type OrgDb,
} from "../services/ai-attachments.js";
import {
  parseAIAttachments,
  getDefaultParserLimits,
  buildAttachmentContextBlock,
  getAttachmentUsageMetadata,
} from "../services/ai-attachment-parser.js";
import { buildProviderMessages, getImageUsageMetadata, type MultimodalMessage } from "../services/ai-multimodal.js";
import type { AIAttachmentReference, ResolvedAIAttachment, NormalizedAttachment, NormalizedImageAttachment } from "../types/ai-attachments.js";
import { resolveEffectivePermissions } from "../agent/permissions.js";
import { filterDestinations, validateNavAction, REGISTRY_VERSION } from "../agent/destination-registry.js";
import { buildNavPromptSection, NavMarkerFilter, extractNavMarker } from "../agent/nav-agent.js";
import { createNavigationProposal, createPendingToolProposal } from "../agent/proposals.js";
import { resolvePlanFromDB } from "../middlewares/planGate.js";
// ── AI Agents Phase 2 — tool calling ──────────────────────────────────────────
import { MISSION_TOOLS, type AIToolCall } from "../agent/mission-tools.js";
// ── AI Agents Phase 3 — outils calendrier ─────────────────────────────────────
import { CALENDAR_TOOLS } from "../agent/calendar-tools.js";
/** Registre unifié missions + calendrier passé au provider lors du tool calling. */
const ALL_TOOLS = [...MISSION_TOOLS, ...CALENDAR_TOOLS];
/** Map de lookup unifié — phase 2 missions + phase 3 calendrier. */
const ALL_TOOLS_MAP = new Map(ALL_TOOLS.map((t) => [t.name, t]));
import { aiChatWithTools, buildToolResultMessages, type ToolCallingResult } from "../services/ai-tool-calling.js";
import { executeTool, type ExecuteContext } from "../agent/tool-executor.js";
import { undoAction } from "../agent/undo.js";

const router = Router();
// aiRateLimit applied per POST route below — GET endpoints (history, usage, recommendations) are not rate-limited

// ── Rate limiting ─────────────────────────────────────────────────────────────
const AI_RATE_LIMIT = 30;
const AI_RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.ip
    ?? "unknown";
}

// gpt-5+ models don't support `max_tokens`/custom `temperature` — they require
// `max_completion_tokens` and always run at temperature 1.
// Every gpt-5 family model (including gpt-5-mini) can spend part of that
// budget on internal reasoning tokens before writing visible output —
// observed intermittently even on short prompts — which can silently return
// an empty response. Force low reasoning effort and pad the budget so
// there's always room left for the actual answer.
function completionParams(model: string, maxTokens: number, temperature?: number): Record<string, unknown> {
  if (/^gpt-5/.test(model)) {
    return {
      max_completion_tokens: maxTokens + 500,
      reasoning_effort: "low",
    };
  }
  return { max_tokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) };
}



function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + AI_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= AI_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── OpenAI client factory (legacy, kept for non-migrated paths) ────────────
async function getOpenAI() {
  const { resolveOpenAIConnection } = await import("../lib/openai-client.js");
  const conn = resolveOpenAIConnection();
  if (!conn) return null;
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: conn.apiKey, ...(conn.baseURL ? { baseURL: conn.baseURL } : {}) });
}

// ── Unified AI helper (replaces direct openai.chat.completions.create) ────────
/** Call aiChat via the unified provider layer with task-based routing and fallback */
async function callAIWithFallback(args: {
  task: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  provider?: AIProviderId;
  model?: string;
  json?: boolean;
  orgId?: string;
}): Promise<{ text: string; model: string; provider: AIProviderId; tokensIn: number; tokensOut: number; latencyMs: number; _ai: { provider: AIProviderId; model: string; switchReason?: string } }> {
  const t0 = Date.now();

  // Resolve provider/model/maxTokens from org preferences when orgId is provided
  let provider = args.provider ?? "openai";
  let model = args.model ?? "gpt-5-mini";
  let maxTokens = args.maxTokens ?? 1400;

  if (args.orgId) {
    try {
      const cfg = await selectOptimalModel(args.task, args.orgId);
      provider = cfg.provider;
      model = cfg.model;
      maxTokens = cfg.maxTokens;
    } catch (err) {
      logger.warn({ err, orgId: args.orgId, task: args.task }, "[AI] selectOptimalModel failed — using defaults");
    }
  } else {
    const { resolveTaskProvider } = await import("../services/ai-providers/task-router.js");
    const resolved = resolveTaskProvider(args.task, args.provider);
    provider = resolved.provider;
    model = args.model ?? resolved.model;
  }

  try {
    const result = await aiChat({
      provider,
      model,
      systemPrompt: args.systemPrompt,
      messages: [{ role: "user", content: args.userPrompt }],
      maxTokens,
      temperature: args.temperature,
      json: args.json,
    });
    const latencyMs = Date.now() - t0;
    return {
      text: result.text || "",
      model: result._ai.model,
      provider: result._ai.provider,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      latencyMs,
      _ai: result._ai,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logger.error({ err, task: args.task, provider, model, latencyMs }, "[AI] callAIWithFallback failed — all providers exhausted");
    throw Object.assign(
      new Error("AI_UNAVAILABLE: tous les providers IA sont indisponibles"),
      { code: "AI_UNAVAILABLE", cause: err }
    );
  }
}

function aiUnavailableJson(): { code: string; error: string } {
  return { code: "AI_UNAVAILABLE", error: "Service IA temporairement indisponible — tous les providers sont hors ligne" };
}

// ── Shared context builder ────────────────────────────────────────────────────
// Queries REAL data from DB. All advice generated using this context must be
// grounded in the data returned here — no invented generic recommendations.
/** Categorize PSI issue titles into SEO buckets for richer consultant context */
function categorizeIssues(titles: string[]): Record<string, string[]> {
  const cats: Record<string, string[]> = {
    "Performance / Core Web Vitals": [],
    "Meta & Contenu SEO": [],
    "Accessibilité": [],
    "SEO Technique": [],
    "Autres": [],
  };
  for (const t of titles) {
    const low = t.toLowerCase();
    if (/lcp|fcp|cls|tbt|tti|render|image|script|cache|compress|unused|speed|ttfb|resource|defer|async|lazy|webp|avif|minif|font|preload|preconnect|css block/.test(low)) {
      cats["Performance / Core Web Vitals"]!.push(t);
    } else if (/title|description|meta|h1|h2|canonical|duplicate|keyword|content|structured.data|schema|open.graph|og:|twitter:/.test(low)) {
      cats["Meta & Contenu SEO"]!.push(t);
    } else if (/alt|aria|contrast|label|focus|tab.order|button|form|input|role|color ratio/.test(low)) {
      cats["Accessibilité"]!.push(t);
    } else if (/robot|sitemap|redirect|https|http|ssl|crawl|index|noindex|canonical|url|link|broken|404|intern|extern|backlink|hreflang|pagination/.test(low)) {
      cats["SEO Technique"]!.push(t);
    } else {
      cats["Autres"]!.push(t);
    }
  }
  return cats;
}

async function buildFlowpointContext(extra?: Record<string, unknown>, orgId?: string, contextFactor = 1.0): Promise<string> {
  try {
    const oid = orgId ?? "default";

    // Context depth limits — scaled by contextFactor via computeContextLimits()
    // NORMAL(1.0): kw=15, comp=5, audit=10, mon=10, psi=5
    // OPTIMIZED(0.85): kw=13, comp=4, audit=9, mon=9, psi=4
    // ECONOMY(0.60):   kw=9,  comp=3, audit=6, mon=6, psi=3
    // CRITICAL(0.35):  kw=5,  comp=2, audit=4, mon=4, psi=2
    const { kwLimit, compLimit, auditLimit, monLimit, psiLimit, kwDisplayLim } = computeContextLimits(contextFactor);

    let keywords: Array<{ keyword: string; current_position: number | null; prev_position: number | null; position_change: number | null; search_volume: number | null; trend: string | null }> = [];
    let competitors: Array<{ name: string; domain?: string; rating?: number; reviews_count?: number }> = [];
    let gscConnected = false;
    let ga4Connected = false;
    let gbpConnected = false;
    let clientDomainAuthority: number | null = null;
    let clientDomain = "";
    // Real PSI critical issues per audit URL (from psi_cache)
    let psiIssuesByUrl: Map<string, Array<{title: string}>> = new Map();

    {
      const [kwRes, compRes, gbpRes, clientDrRes] = await Promise.allSettled([
        pool.query(
          `SELECT keyword, current_position, prev_position, position_change, search_volume, trend
           FROM tracked_keywords
           WHERE org_id=$1 AND active=true
           ORDER BY search_volume DESC NULLS LAST, current_position ASC NULLS LAST
           LIMIT ${kwLimit}`,
          [oid]
        ),
        pool.query(
          `SELECT name, url, domain_rating, keywords AS kw_count
           FROM competitors WHERE org_id=$1 ORDER BY domain_rating DESC LIMIT ${compLimit}`,
          [oid]
        ),
        pool.query(
          `SELECT id FROM google_tokens WHERE org_id=$1 LIMIT 1`,
          [oid]
        ),
        // Client's own domain authority from DataForSEO metrics cache (if available)
        pool.query(
          `SELECT domain, domain_authority, backlinks_count FROM seo_domain_metrics
           WHERE org_id=$1
           ORDER BY cached_at DESC LIMIT 1`,
          [oid]
        ).catch(() => ({ rows: [] as Array<Record<string,unknown>> })),
      ]);
      if (kwRes.status === "fulfilled")   keywords    = kwRes.value.rows as typeof keywords;
      if (compRes.status === "fulfilled") competitors = (compRes.value.rows as Array<Record<string,unknown>>).map(r => ({
        name: String(r["name"] ?? ""),
        domain: String(r["url"] ?? ""),
        rating: Number(r["domain_rating"] ?? 0),
        reviews_count: Number(r["kw_count"] ?? 0),
      }));
      if (gbpRes.status === "fulfilled")  gbpConnected = gbpRes.value.rows.length > 0;
      if (clientDrRes.status === "fulfilled" && (clientDrRes as PromiseFulfilledResult<{rows: Array<Record<string,unknown>>}>).value.rows[0]) {
        const r = (clientDrRes as PromiseFulfilledResult<{rows: Array<Record<string,unknown>>}>).value.rows[0];
        if (r["domain_authority"] != null) clientDomainAuthority = Number(r["domain_authority"]);
        if (r["domain"]) clientDomain = String(r["domain"]);
      }

      const [gscCheck, ga4Check] = await Promise.allSettled([
        pool.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema='public' AND table_name='gsc_sites'`
        ),
        pool.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema='public' AND table_name='ga4_properties'`
        ),
      ]);
      if (gscCheck.status === "fulfilled" && Number((gscCheck.value.rows[0] as Record<string,unknown>)["cnt"] ?? 0) > 0) {
        const r = await pool.query(`SELECT id FROM gsc_sites WHERE org_id=$1 LIMIT 1`, [oid]).catch(() => ({ rows: [] }));
        gscConnected = r.rows.length > 0;
      }
      if (ga4Check.status === "fulfilled" && Number((ga4Check.value.rows[0] as Record<string,unknown>)["cnt"] ?? 0) > 0) {
        const r = await pool.query(`SELECT id FROM ga4_properties WHERE org_id=$1 LIMIT 1`, [oid]).catch(() => ({ rows: [] }));
        ga4Connected = r.rows.length > 0;
      }
    }

    const [audits, monitors] = await Promise.all([
      db.select().from(auditsTable)
        .where(eq(auditsTable.orgId, oid))
        .orderBy(desc(auditsTable.createdAt))
        .limit(auditLimit),
      db.select().from(monitorsTable)
        .where(eq(monitorsTable.orgId, oid))
        .limit(monLimit),
    ]);

    // Fetch real PSI critical issues for top audited URLs (scaled by contextFactor)
    if (audits.length > 0) {
      const urls = audits.slice(0, psiLimit).map(a => a.url);
      // Join with audits to ensure only URLs belonging to this org are returned
      const psiRes = await pool.query(
        `SELECT DISTINCT ON (p.url) p.url, p.critical_issues
         FROM psi_cache p
         JOIN audits a ON a.url = p.url AND a.org_id = $2
         WHERE p.url = ANY($1) AND p.strategy='mobile'
         ORDER BY p.url, p.analyzed_at DESC`,
        [urls, oid]
      ).catch(() => ({ rows: [] as Array<Record<string,unknown>> }));
      const seen = new Set<string>();
      for (const row of psiRes.rows) {
        const u = String(row["url"] ?? "");
        if (seen.has(u)) continue;
        seen.add(u);
        try {
          const issues = JSON.parse(String(row["critical_issues"] ?? "[]")) as Array<{title?: string}>;
          if (Array.isArray(issues)) psiIssuesByUrl.set(u, issues.map(i => ({ title: i.title ?? "" })).filter(i => i.title));
        } catch { /* ignore parse errors */ }
      }
    }

    const avgScore = audits.length > 0
      ? Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)
      : 0;
    const downCount = monitors.filter(m => m.status === "down").length;
    const criticalAudits = audits.filter(a => a.score < 50);
    const warningAudits  = audits.filter(a => a.score >= 50 && a.score < 75);

    const e = extra ?? {};
    const plan         = (e["plan"] as string)  ?? store.me.plan ?? "Pro";
    const firstName    = (e["firstName"] as string) ?? "";
    const streak       = (e["streak"] as number) ?? 0;
    const localScore   = (e["localScore"] as number) ?? 0;
    const convScore    = (e["conversionScore"] as number) ?? 0;
    const city         = (e["city"] as string)  ?? null;
    const topKwFront   = (e["topKeywords"] as Array<{keyword:string;position:number}>) ?? [];
    const recentAct    = (e["recentActivity"] as string[]) ?? [];
    const topCroRecs   = (e["topCroRecs"] as string[]) ?? [];
    const revLeak      = (e["revenueLeak"] as number) ?? 0;
    // Real top missions from DB (by priority_score for agent context)
    let topMissions: Array<{ id: string; title: string; status: string; priority: string; category: string; dueDate: string | null }> = [];
    {
      const mRes = await pool.query(
        `SELECT id, title, status, priority, category, due_date
         FROM missions WHERE org_id=$1 AND status NOT IN ('done','dismissed')
         ORDER BY priority_score DESC NULLS LAST LIMIT 10`,
        [oid]
      ).catch(() => ({ rows: [] }));
      topMissions = mRes.rows as typeof topMissions;
    }

    const missAct      = (e["missionsActive"] as number) ?? topMissions.filter(m => m.status === "in_progress").length;
    const missComp     = (e["missionsCompleted"] as number) ?? 0;
    const activeAlerts = (e["activeAlertsCount"] as number) ?? 0;
    const aiCredits    = (e["aiCredits"] as number|null) ?? null;
    // Frontend-provided detailed issue list for current audit (enriched by dashboard)
    const frontendIssues = (e["auditIssues"] as Array<{label:string;sev:string;roi:string}>) ?? [];

    const allKw: Array<{keyword: string; position: number | null; delta: number | null; volume: number | null; trend: string | null}> = [
      ...keywords.map(k => ({ keyword: k.keyword, position: k.current_position, delta: k.position_change, volume: k.search_volume, trend: k.trend })),
      ...topKwFront
        .filter(fk => !keywords.some(k => k.keyword === fk.keyword))
        .map(fk => ({ keyword: fk.keyword, position: fk.position, delta: null, volume: null, trend: null })),
    ];

    // Keyword position analysis
    const kwCritical = allKw.filter(k => k.position !== null && k.position > 20);
    const kwNearTop  = allKw.filter(k => k.position !== null && k.position !== null && k.position >= 4 && k.position <= 10);
    const kwTop3     = allKw.filter(k => k.position !== null && k.position !== null && k.position <= 3);

    const lines: string[] = [
      `=== CONTEXTE FLOWPOINT — CONSULTANT SEO SENIOR ===`,
      `Utilisateur : ${firstName || "Utilisateur"} | Plan : ${plan} | OrgId : ${oid}`,
      city ? `Zone géographique : ${city}` : "",
      ``,
      `=== AUDITS SEO — DONNÉES RÉELLES ===`,
      `Score SEO moyen : ${avgScore}/100 sur ${audits.length} site(s) audité(s)`,
      criticalAudits.length > 0
        ? `CRITIQUE — Sites en dessous de 50 : ${criticalAudits.map(a => `${a.url} [score=${a.score}/100, vitesse=${a.speed ?? "?"}/100, ${a.issues} issue(s) critiques]`).join(" | ")}`
        : `Aucun site en zone critique (score < 50)`,
      warningAudits.length > 0
        ? `ATTENTION — Sites 50-74 : ${warningAudits.map(a => `${a.url} [score=${a.score}/100, vitesse=${a.speed ?? "?"}/100, ${a.issues} issue(s)]`).join(" | ")}`
        : "",
      audits.length > 0
        ? `Tous les audits : ${audits.slice(0, psiLimit).map(a =>
            `${a.url} score=${a.score}/100 perf=${a.speed ?? "?"}/100 issues=${a.issues}`
          ).join(" | ")}`
        : "Aucun audit effectué",
      ``,
      `=== PROBLÈMES RÉELS DÉTECTÉS (PSI) PAR CATÉGORIE ===`,
      ...audits.slice(0, psiLimit).flatMap(a => {
        const issues = psiIssuesByUrl.get(a.url) ?? [];
        if (issues.length === 0) return [];
        const cats = categorizeIssues(issues.map(i => i.title));
        const catSummary = Object.entries(cats)
          .filter(([, v]) => v.length > 0)
          .map(([cat, items]) => `${cat} : ${items.slice(0, 3).join(", ")}`)
          .join(" | ");
        return [`${a.url} — ${catSummary || issues.slice(0, 4).map(i => i.title).join(" | ")}`];
      }),
      psiIssuesByUrl.size === 0 && frontendIssues.length > 0
        ? `Problèmes frontend : ${frontendIssues.slice(0, 5).map(i => `${i.label} (${i.sev}, gain=${i.roi})`).join(" | ")}`
        : "",
      ``,
      `=== KEYWORDS — DONNÉES RÉELLES ===`,
      allKw.length > 0
        ? `Mots-clés suivis (${allKw.length}) : ${allKw.slice(0, kwDisplayLim).map(k =>
            `"${k.keyword}" pos=${k.position ?? "?"}${k.delta != null ? (k.delta > 0 ? ` ▲${k.delta}` : k.delta < 0 ? ` ▼${Math.abs(k.delta)}` : " =") : ""} ${k.volume ? `vol=${k.volume}` : ""} ${k.trend ? `trend=${k.trend}` : ""}`.trim()
          ).join(" | ")}`
        : "Aucun mot-clé suivi",
      kwTop3.length > 0    ? `Top 3 : ${kwTop3.map(k => `"${k.keyword}" pos ${k.position}`).join(", ")}` : "",
      kwNearTop.length > 0 ? `Positions 4-10 (à pousser en top 3) : ${kwNearTop.map(k => `"${k.keyword}" pos ${k.position}`).join(", ")}` : "",
      kwCritical.length > 0 ? `Hors top 20 (travail de fond) : ${kwCritical.slice(0,5).map(k => `"${k.keyword}" pos ${k.position}`).join(", ")}` : "",
      ``,
      `=== MONITORING ===`,
      `Monitors : ${monitors.length} total, ${downCount} DOWN, ${monitors.length - downCount} UP`,
      downCount > 0
        ? `⚠ Sites DOWN : ${monitors.filter(m => m.status === "down").map(m => `${m.url || m.name || "?"}`).join(", ")}`
        : `Tous les monitors sont UP`,
      ``,
      `=== CONNEXIONS GOOGLE ===`,
      `Google Search Console : ${gscConnected ? "✅ Connecté" : "❌ Non connecté — données de clics/impressions manquantes"}`,
      `Google Analytics 4 : ${ga4Connected ? "✅ Connecté" : "❌ Non connecté — données trafic manquantes"}`,
      `Google Business Profile : ${gbpConnected ? "✅ Connecté" : "❌ Non connecté — visibilité locale limitée"}`,
      ``,
      `=== CONCURRENTS ===`,
      competitors.length > 0
        ? competitors.map(c => `${c.name}${c.domain ? ` (${c.domain})` : ""} DR=${c.rating ?? "?"}`).join(" | ")
        : "Aucun concurrent enregistré",
      competitors.length > 0 && competitors[0]!.rating
        ? clientDomainAuthority !== null
          ? `Écart DR : votre domaine ${clientDomain ? `(${clientDomain})` : ""} DA=${clientDomainAuthority} vs concurrent "${competitors[0]!.name}" DR=${competitors[0]!.rating} — ${competitors[0]!.rating > clientDomainAuthority ? `retard de ${competitors[0]!.rating - clientDomainAuthority} pts DR` : `avance de ${clientDomainAuthority - competitors[0]!.rating} pts DR`}`
          : `Top concurrent "${competitors[0]!.name}" DR=${competitors[0]!.rating} — DA de votre domaine non encore mesuré (connectez DataForSEO pour l'obtenir)`
        : "",
      ``,
      `=== PERFORMANCE ===`,
      `Score local SEO : ${localScore}/100`,
      `Score conversion : ${convScore}/100`,
      `Streak activité : ${streak} jour(s)`,
      ``,
      `=== MISSIONS & ALERTES ===`,
      `Missions actives : ${missAct} | Missions complétées : ${missComp}`,
      `Alertes actives : ${activeAlerts}`,
      topMissions.length > 0
        ? `Top missions prioritaires :\n${topMissions.map(m =>
            `  - [${m.id}] "${m.title}" | statut: ${m.status} | priorité: ${m.priority} | catégorie: ${m.category}${m.dueDate ? ` | échéance: ${m.dueDate}` : ""}`
          ).join("\n")}`
        : "Aucune mission active",
      topCroRecs.length > 0 ? `Recommandations CRO : ${topCroRecs.join(" / ")}` : "",
      revLeak > 0 ? `Fuites de revenus détectées : ${revLeak}` : "",
      ``,
      `=== ACTIVITÉ RÉCENTE ===`,
      recentAct.length > 0 ? recentAct.join(" | ") : "Aucune activité récente",
      aiCredits != null ? `Crédits IA restants : ${aiCredits}` : "",
    ];

    // === CALENDRIER — Phase 3 : contexte événements ===
    try {
      const calNow      = new Date();
      const calToday    = calNow.toISOString().slice(0, 10);
      const calTimeHHMM = calNow.toISOString().slice(11, 16); // HH:MM en UTC
      const calWeekEnd  = new Date(calNow.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
      const calRes = await pool.query(
        `SELECT id, title, date, start_time, duration, type, client_name, priority
         FROM calendar_events
         WHERE org_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date ASC, start_time ASC
         LIMIT 20`,
        [oid, calToday, calWeekEnd]
      ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

      const calRows: Array<Record<string, unknown>> = calRes.rows as Array<Record<string, unknown>>;
      const calTodayEvts = calRows.filter(e => e["date"] === calToday);
      const calUpcoming  = calRows.filter(e => String(e["date"]) > calToday);

      // Détection de conflits de créneau
      const calConflicts: string[] = [];
      for (let ci = 0; ci < calRows.length; ci++) {
        for (let cj = ci + 1; cj < calRows.length; cj++) {
          const ei = calRows[ci]!, ej = calRows[cj]!;
          if (ei["date"] !== ej["date"] || !ei["start_time"] || !ej["start_time"]) continue;
          const [h1 = 0, m1 = 0] = String(ei["start_time"]).split(":").map(Number);
          const [h2 = 0, m2 = 0] = String(ej["start_time"]).split(":").map(Number);
          const s1 = h1 * 60 + m1, e1 = s1 + (Number(ei["duration"]) || 60);
          const s2 = h2 * 60 + m2, e2 = s2 + (Number(ej["duration"]) || 60);
          if (s1 < e2 && e1 > s2) {
            calConflicts.push(`"${ei["title"]}" ${ei["start_time"]} ↔ "${ej["title"]}" ${ej["start_time"]} le ${ei["date"]}`);
          }
        }
      }

      lines.push(
        ``,
        `=== CALENDRIER (7 prochains jours) ===`,
        `Date et heure actuelles (UTC) : ${calToday} à ${calTimeHHMM}`,
        `RÉSOLUTION DES EXPRESSIONS RELATIVES — Utilise cette date/heure pour calculer "dans 30 minutes", "dans 2 heures", "demain matin", "vendredi dans deux semaines", etc. Ne fais aucune supposition silencieuse. Si une expression est ambiguë, demande une clarification avant d'appeler l'outil.`,
        `RÈGLES OUTILS CALENDRIER (obligatoires) :`,
        `- Toute demande de création/modification/déplacement/suppression → appeler l'outil correspondant (create/update/move/delete_calendar_event). Ne jamais décrire l'action sans la faire.`,
        `- Toute question sur les événements ("qu'est-ce que j'ai cette semaine ?", "quels sont mes RDV ?", "mes prochains rendez-vous ?") → appeler search_calendar_event PUIS expliquer les résultats en texte.`,
        `- Après tout appel d'outil : TOUJOURS produire une réponse textuelle qui explique le résultat à l'utilisateur. Ne jamais laisser le tool_result sans commentaire.`,
        `- Pour les questions d'analyse (conflits, planning) : si le contexte calendrier ci-dessus contient déjà l'information, tu peux répondre directement en texte sans appeler un outil.`,
        `- Si un paramètre obligatoire manque → demander à l'utilisateur AVANT d'appeler l'outil.`,
        calTodayEvts.length > 0
          ? `Aujourd'hui (${calTodayEvts.length} événement${calTodayEvts.length > 1 ? "s" : ""}) : ${calTodayEvts.map(e =>
              `"${e["title"]}"${e["start_time"] ? ` à ${e["start_time"]}` : ""} (${e["duration"] ?? 60} min)${e["client_name"] ? ` — ${e["client_name"]}` : ""}${e["priority"] && e["priority"] !== "normal" ? ` [${e["priority"]}]` : ""}`
            ).join(" | ")}`
          : `Aujourd'hui : aucun événement`,
        calUpcoming.length > 0
          ? `À venir cette semaine (${calUpcoming.length}) : ${calUpcoming.slice(0, 8).map(e =>
              `${e["date"]} "${e["title"]}"${e["start_time"] ? ` ${e["start_time"]}` : ""}`
            ).join(" | ")}`
          : `Aucun événement dans les 7 prochains jours`,
        calConflicts.length > 0
          ? `⚠ Conflits de créneau détectés : ${calConflicts.join(" / ")}`
          : `Aucun conflit de créneau`,
      );
    } catch { /* non-fatal : contexte calendrier ignoré */ }

    return lines.filter(l => l !== "").join("\n");
  } catch {
    return `Platform: Flowpoint SaaS SEO Dashboard. Plan: ${store.me.plan ?? "Pro"}.`;
  }
}

// Strict instruction inserted into every system prompt to prevent hallucinated generic advice
const STRICT_AI_RULE = `
RÈGLES DU CONSULTANT (non négociables) :

OUVERTURE DES RÉPONSES — règle absolue, appliquée à chaque message
- Ne JAMAIS commencer par "Bonjour !", "Salut !", ou toute formule de salutation sauf pour le tout premier message d'une conversation neuve.
- Ne JAMAIS qualifier la question : interdire "C'est une excellente question", "Bonne question !", "Vous avez raison de poser cette question", "J'ai bien pris en compte votre question".
- Ne JAMAIS utiliser de phrase de remplissage : "Bien sûr !", "Absolument !", "Certainement !", "En effet !", "Tout à fait !", "Je comprends votre préoccupation".
- Commencer DIRECTEMENT par la réponse utile, sans préambule.
- Varier les ouvertures selon le contexte :
  · Constat direct : "Votre score SEO de X/100 indique…"
  · Données d'abord : "J'ai regardé vos audits. Le frein principal est…"
  · Bonne nouvelle : "La bonne nouvelle — vos monitors sont tous UP."
  · Prise de position : "Si je ne devais vous conseiller qu'une chose aujourd'hui…"
  · Reformulation utile : "Pour votre site [domaine], voici ce que je vois…"
- Jamais deux réponses consécutives avec la même structure d'ouverture.

TON & LONGUEUR
- Tu parles comme un consultant humain qui a étudié le dossier avant la réunion, pas comme un outil qui exporte des JSON.
- Phrase d'ouverture humaine SANS salutation : "J'ai analysé votre site. Voici ce que je retiens." ou "Bonne nouvelle — les données sont là, voici l'essentiel."
- Première réponse à une question générale : 250–350 mots maximum. Offre ensuite "Voulez-vous que je détaille ?" — ne développe pas sans invitation.
- Ne répète jamais le même chiffre deux fois dans la même réponse.
- Montre toujours un point positif avant les problèmes. L'utilisateur doit quitter la conversation motivé, pas découragé.
- Évite les mots : "critique", "mauvais", "erreur", "échec". Utilise : "à améliorer", "frein principal", "axe prioritaire".
- Préfère : "J'ai remarqué…", "Je vous recommande…", "Ce point mérite votre attention…", "La bonne nouvelle est que…"
  Jamais : "Analyse terminée.", "Score détecté.", "Résultat :"

RÉPONDRE D'ABORD À LA QUESTION (point le plus important)
- Quand l'utilisateur pose une question simple, réponds-y directement en 2–3 phrases, puis propose maximum 3 actions.
- Ne transforme JAMAIS une question simple en audit complet non demandé.
- Exemple : "Mon site est-il bon ?" → réponse directe (1 phrase), explication courte (2 phrases), 3 actions max.
- Si l'utilisateur veut plus de détails, il les demandera. Ne jamais anticiper avec une page de texte.

3 PRIORITÉS MAXIMUM
- Même si 25 problèmes sont détectés, l'utilisateur ne voit que les 3 plus importants.
- Les autres n'apparaissent que si l'utilisateur demande explicitement "donne-moi plus de détails" ou "quoi d'autre".
- Dans la hiérarchie : 1 action en 🔴, 1 en 🟠, 1 en 🟢 — pas davantage par défaut.

ADAPTATION AU NIVEAU DE L'UTILISATEUR
- Débutant (vocabulaire simple, questions générales comme "mon site est-il bon ?") :
  → Langage du quotidien, aucun terme technique, analogies concrètes.
  → Ex : "Google a du mal à lire certaines pages de votre site" plutôt que "erreurs d'indexation détectées".
- Expert (utilise des termes comme Core Web Vitals, crawl, balises meta, schema.org) :
  → Détails techniques, chiffres précis, terminologie correcte autorisée.
- L'utilisateur n'active aucun mode — tu détectes son niveau dans ses messages et tu adaptes.

DONNÉES DU COMPTE — UTILISATION NATURELLE
- Utilise les données réelles de manière intégrée, jamais comme une liste brute.
- Mauvais : "Connectez Google Search Console."
- Bon : "Je vois que Google Search Console n'est pas encore connectée à votre compte. Sans cette connexion, je ne peux pas voir vos impressions ni vos clics réels dans Google — c'est dommage car c'est là que se trouvent les meilleures opportunités."
- Même principe pour : audits, mots-clés, concurrents, GBP, missions, alertes, moniteurs.
- L'utilisateur doit avoir l'impression que tu analyses réellement SON espace FlowPoint, pas que tu donnes des conseils génériques.

CHIFFRES COMME ILLUSTRATIONS, PAS COMME DONNÉES BRUTES
- Les chiffres servent l'explication, ils ne la remplacent pas.
- Interdit : "score 25 / score 24 / score 26 / perf 92 / perf 60 / issues 16"
- Autorisé : "Votre score moyen tourne autour de 25/100, ce qui signifie que Google a aujourd'hui du mal à vous trouver."
- Un chiffre = une phrase d'explication. Jamais une liste de métriques nues.

CONTEXTE POUR CHAQUE RECOMMANDATION
- Ne jamais écrire seulement "Corrigez ce problème."
- Chaque action doit répondre à 3 questions implicites :
  1. Pourquoi c'est important ? (impact sur Google / le client)
  2. Ce que ça va changer concrètement ?
  3. Ce que le client peut espérer obtenir ?

JARGON INTERDIT — traduis toujours en langage client (artisan, restaurateur, dentiste)
- frontend / backend / code → "votre site" ou "certaines pages de votre site" — ne jamais mentionner le mot "code" sauf si l'utilisateur est expert
- canonical → "Google identifie parfois la mauvaise version de votre page" ou "certaines pages se dupliquent aux yeux de Google"
- robots.txt / sitemap → "Google a du mal à trouver toutes vos pages" (ne pas nommer le fichier)
- LCP → "votre page met trop de temps à s'afficher"
- CLS → "certains éléments bougent pendant le chargement"
- CTR → "le pourcentage de personnes qui cliquent sur votre résultat Google"
- SERP → "les résultats Google"
- backlinks → "d'autres sites qui font référence au vôtre"
- JavaScript bloquant → "des éléments de votre site ralentissent son affichage"
- balises meta → "le titre et la description qui apparaissent dans Google"
- indexation → "Google n'a pas encore trouvé ou analysé cette page"
- crawl → "la visite de votre site par Google"

PERSONNALITÉ ET PRISE DE POSITION
- Ne donne jamais trois recommandations génériques de même poids. Prends position.
- Formules autorisées : "Si je ne devais vous conseiller qu'une seule chose aujourd'hui, ce serait celle-ci."
  "C'est aujourd'hui le frein principal qui limite votre visibilité." 
  "Une fois cette étape terminée, les autres optimisations seront beaucoup plus efficaces."
  "Si j'étais votre consultant, voici ce que je mettrais en priorité absolue."
  "J'ai passé en revue les données de votre compte. Voici ce qui retient le plus mon attention."
- Montre clairement que tu as une opinion — le client veut une recommandation, pas une liste équilibrée.

IMPACT : JAMAIS DE CHIFFRES PRÉCIS
- Interdit : "+15 points SEO", "+10-20% de trafic", "+X% de conversions"
- Ces chiffres créent de fausses attentes et engagent ta responsabilité.
- Autorisé : "C'est généralement l'action qui a le plus d'impact sur la visibilité."
  "Ce type de correction fait souvent partie des gains les plus rapides à obtenir."
  "Google récompense habituellement ces optimisations assez rapidement."

VARIER NATURELLEMENT LA STRUCTURE
- Ne pas systématiquement reproduire le même template (Pourquoi / Ce que ça change / Temps).
- Alterner : anecdote courte, question rhétorique, constat direct, bonne nouvelle d'abord.
- Si l'utilisateur repose une question dans la même conversation : adapter le ton, ne pas répéter le même format d'introduction.

EXPLOITER FLOWPOINT NATURELLEMENT
- Toujours contextualiser avec les données du compte — pas de conseils génériques.
- Mauvais : "Votre fiche Google Business Profile est connectée."
- Bon : "J'ai vu que votre fiche Google est déjà connectée à FlowPoint — c'est un vrai avantage, je peux suivre votre visibilité locale en temps réel."
- Mauvais : "Connectez Google Search Console."
- Bon : "Je vois que Google Search Console n'est pas encore liée à votre compte. Sans ça, je ne peux pas voir combien de fois votre site apparaît dans Google ni sur quels mots — c'est dommage car c'est là que se trouvent les meilleures opportunités."

HIÉRARCHIE VISUELLE (toute réponse avec recommandations)
📊 Résumé
[1–2 phrases, positif d'abord]

✅ Ce qui fonctionne bien
[1–2 points concrets]

⚠️ Ce qui mérite votre attention
[contexte court — pourquoi, ce que ça bloque]

🎯 Les 3 priorités
🔴 À faire immédiatement — [titre sans jargon]
→ [explication client en 1 phrase]  →  [impact qualitatif, pas de chiffres]
🟠 À faire cette semaine — [titre]
🟢 À améliorer ensuite — [titre]

👉 Prochaine étape
[invitation concrète : "Si vous le souhaitez, je détaille comment traiter cette première priorité."]

DONNÉES
- Cite les chiffres exacts du contexte une seule fois, à l'endroit le plus utile.
- N'invente aucune donnée absente du contexte.
- Si GSC/GA4/GBP ne sont pas connectés, le dire en UNE phrase naturelle, après les recommandations.
- Si une donnée manque, signale-le en une ligne et continue.

CLÔTURE
- Termine par une invitation concrète : "Si vous le souhaitez, je peux détailler comment résoudre cette première priorité étape par étape." ou "Quelle priorité voulez-vous approfondir ?"
- Ne termine jamais par une liste exhaustive de tout ce qui va mal.
`;

// ── Persist chat history ──────────────────────────────────────────────────────
async function persistChatMessage(opts: {
  orgId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  feature: string;
  model?: string;
  tokensUsed?: number;
  conversationId?: string;
}): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      const id = `ach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await client.query(`
        INSERT INTO ai_chat_history (id, org_id, user_id, role, content, feature, model, tokens_used, conversation_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [id, opts.orgId, opts.userId, opts.role, opts.content, opts.feature, opts.model ?? "gpt-5-mini", opts.tokensUsed ?? 0, opts.conversationId ?? null]);
    } finally {
      client.release();
    }
  } catch { /* silent */ }
}

// ── GET /ai/history — load chat history ──────────────────────────────────────
router.get("/ai/history", async (req, res) => {
  const orgId = req.orgId ?? "default";
  const limit = Math.min(Number(req.query["limit"] ?? 50), 100);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT id, role, content, feature, model, created_at
        FROM ai_chat_history
        WHERE org_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `, [orgId, limit]);
      res.json({ messages: rows.reverse() });
    } finally {
      client.release();
    }
  } catch {
    res.json({ messages: [] });
  }
});

// ── GET /ai/config — read current AI provider + intensity ───────────────────
router.get("/ai/config", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgId ?? "default";
  try {
    const prefs = await loadOrgAIPrefs(orgId);
    res.json({
      provider:  prefs.preferredProvider ?? "openai",
      intensity: prefs.aiIntensity       ?? "Équilibré",
      modules:   prefs.aiModules         ?? {},
    });
  } catch {
    res.json({ provider: "openai", intensity: "Équilibré", modules: {} });
  }
});

// ── PATCH /ai/config — update provider + intensity via prefs ─────────────────
router.patch("/ai/config", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgId ?? "default";
  const { provider, intensity } = req.body as { provider?: string; intensity?: string };
  try {
    // Read current prefs
    const { rows } = await pool.query(
      `SELECT settings FROM user_prefs WHERE org_id=$1 LIMIT 1`,
      [orgId]
    );
    const current = (rows[0]?.settings as Record<string, unknown>) ?? {};
    const updated: Record<string, unknown> = { ...current };
    if (provider)  updated["preferredProvider"] = provider;
    if (intensity) updated["aiIntensity"]        = intensity;
    await pool.query(
      `INSERT INTO user_prefs (org_id, settings, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings=$2, updated_at=NOW()`,
      [orgId, JSON.stringify(updated)]
    );
    res.json({ ok: true, provider: updated["preferredProvider"], intensity: updated["aiIntensity"] });
  } catch (err) {
    logger.error({ err }, "[ai] PATCH /ai/config failed");
    res.status(500).json({ error: "Failed to update AI config" });
  }
});

// ── AI Agents Phase 2 : boucle tool-calling ───────────────────────────────────
// Appelée UNIQUEMENT depuis le chemin SSE de chatHandler quand enableTools=true.
// Émet des événements SSE directement sur `res`, retourne si l'SSE est suspendu
// (confirmation_request) ou terminé (réponse finale après tool calls).

const MAX_TOOL_ROUNDS = 3;

interface ToolLoopResult {
  /** true = la connexion SSE a été fermée (confirmation_request ou erreur). */
  suspended: boolean;
  /** Texte final si des outils ont été appelés (déjà émis comme delta). */
  finalTextEmitted: boolean;
  /** Liste des tokens d'undo à émettre à la fin. */
  undoTokens: Array<{ actionLogId: string; label: string }>;
  /** Messages mis à jour avec les injections d'outils (pour continuer le stream). */
  messages: import("../services/ai-multimodal.js").MultimodalMessage[];
}

async function runToolCallingLoop(opts: {
  provider: AIProviderId;
  model: string;
  messages: import("../services/ai-multimodal.js").MultimodalMessage[];
  ctx: ExecuteContext;
  sseWrite: (data: string) => void;
  sseClose: () => void;
}): Promise<ToolLoopResult> {
  const { provider, model, ctx } = opts;
  let messages = [...opts.messages] as import("../services/ai-multimodal.js").MultimodalMessage[];
  const undoTokens: Array<{ actionLogId: string; label: string }> = [];
  let toolsCalledTotal = 0;
  // Provider-native messages accumulate across rounds to preserve tool_calls/tool_result structure
  let nativeMessages: unknown[] | undefined;
  // System prompt carried separately for Anthropic/Gemini (not part of their native messages array)
  let carriedSystemPrompt: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let roundResult: ToolCallingResult;
    try {
      roundResult = await aiChatWithTools(
        nativeMessages
          ? { provider, model, tools: ALL_TOOLS, nativeMessages, systemPrompt: carriedSystemPrompt, maxTokens: 1024 }
          : { provider, model, tools: ALL_TOOLS, messages: messages as import("../services/ai-multimodal.js").MultimodalMessage[], maxTokens: 1024 }
      );
      // Carry system prompt for Anthropic/Gemini continuation rounds
      if (round === 0 && roundResult.systemPrompt) {
        carriedSystemPrompt = roundResult.systemPrompt;
      }
    } catch (err) {
      logger.error({ err, round, provider }, "[tool-loop] aiChatWithTools failed");
      // Fail gracefully — let caller proceed with normal stream
      return { suspended: false, finalTextEmitted: false, undoTokens, messages };
    }

    if (!roundResult.hasToolCalls) {
      // No tool calls this round
      if (toolsCalledTotal > 0) {
        // Emit final text as delta events (tools were used in earlier rounds)
        if (roundResult.text) {
          const chunks = roundResult.text.match(/.{1,80}/gs) ?? [roundResult.text];
          for (const chunk of chunks) {
            opts.sseWrite(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
          }
        }
        return { suspended: false, finalTextEmitted: true, undoTokens, messages };
      }
      // Round 0, no tool calls → fall through to normal stream
      return { suspended: false, finalTextEmitted: false, undoTokens, messages };
    }

    // Emit any text from this round as delta events
    if (roundResult.text) {
      const chunks = roundResult.text.match(/.{1,80}/gs) ?? [roundResult.text];
      for (const chunk of chunks) {
        opts.sseWrite(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
      }
    }

    const injections: import("../services/ai-tool-calling.js").ToolResultInjection[] = [];

    for (const toolCall of roundResult.toolCalls) {
      const toolDef = ALL_TOOLS_MAP.get(toolCall.name);
      if (!toolDef) {
        opts.sseWrite(`data: ${JSON.stringify({ tool_call: { id: toolCall.id, name: toolCall.name, status: "unknown_tool" } })}\n\n`);
        injections.push({ toolCallId: toolCall.id, toolName: toolCall.name, content: `Unknown tool: ${toolCall.name}` });
        continue;
      }

      opts.sseWrite(`data: ${JSON.stringify({
        tool_call: { id: toolCall.id, name: toolCall.name, args: toolCall.arguments, confirmationLevel: toolDef.confirmationLevel },
      })}\n\n`);

      if (toolDef.confirmationLevel === "none") {
        // Execute immediately
        const execResult = await executeTool(toolCall, ctx);
        toolsCalledTotal++;
        opts.sseWrite(`data: ${JSON.stringify({
          tool_result: { id: execResult.actionLogId, toolCallId: toolCall.id, name: toolCall.name, ok: execResult.ok, content: execResult.content },
        })}\n\n`);

        // Queue undo token if this was a write with a snapshot
        if (execResult.ok && execResult.actionLogId && execResult.undoLabel) {
          undoTokens.push({ actionLogId: execResult.actionLogId, label: execResult.undoLabel });
        }

        // If navigate_to returned a nav proposal, emit it
        if (execResult.navProposal) {
          opts.sseWrite(`data: ${JSON.stringify({ action_proposal: execResult.navProposal })}\n\n`);
        }

        injections.push({ toolCallId: toolCall.id, toolName: toolCall.name, content: execResult.content });

      } else {
        // preview / full — store pending proposal, emit confirmation_request, suspend
        const preview = buildConfirmationPreview(toolCall.name, toolCall.arguments);
        const proposal = await createPendingToolProposal({
          orgId: ctx.orgId, userId: ctx.userId, conversationId: ctx.conversationId,
          provider, model, toolName: toolCall.name, toolCallId: toolCall.id,
          args: toolCall.arguments, confirmationLevel: toolDef.confirmationLevel, previewText: preview,
        });

        opts.sseWrite(`data: ${JSON.stringify({
          confirmation_request: {
            proposalId: proposal?.proposalId ?? null,
            toolName: toolCall.name,
            confirmationLevel: toolDef.confirmationLevel,
            preview,
            args: sanitizeArgsForClient(toolCall.arguments),
            expiresAt: proposal?.expiresAt ?? null,
          },
        })}\n\n`);

        opts.sseClose();
        return { suspended: true, finalTextEmitted: false, undoTokens, messages };
      }
    }

    // Build provider-native messages for the next round (preserves tool_calls/tool_result structure)
    nativeMessages = buildToolResultMessages(
      provider,
      roundResult.nativeMessages,
      roundResult.text,
      roundResult.toolCalls,
      injections
    );
  }

  // Hit max rounds — emit a user-visible fallback message and close
  logger.warn({ rounds: MAX_TOOL_ROUNDS, ctx: ctx.conversationId }, "[tool-loop] max rounds reached");
  opts.sseWrite(`data: ${JSON.stringify({ delta: "\n\nJe n'ai pas pu terminer cette action automatiquement. Reformulez votre demande ou ouvrez la section Missions pour agir directement." })}\n\n`);
  return { suspended: false, finalTextEmitted: true, undoTokens, messages };
}

function buildConfirmationPreview(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "create_mission":
      return `Créer une mission intitulée "${args["title"] ?? "?"}"${args["priority"] ? ` (priorité: ${args["priority"]})` : ""}${args["category"] ? ` dans la catégorie "${args["category"]}"` : ""}`;
    case "update_mission":
      return `Modifier la mission ID "${args["id"] ?? "?"}"${args["title"] ? ` → titre: "${args["title"]}"` : ""}${args["status"] ? ` → statut: ${args["status"]}` : ""}${args["priority"] ? ` → priorité: ${args["priority"]}` : ""}`;
    case "complete_mission":
      return `Marquer la mission ID "${args["id"] ?? "?"}" comme terminée`;
    case "delete_mission":
      return `⚠ Supprimer définitivement la mission ID "${args["id"] ?? "?"}"`;
    default:
      return `Exécuter l'action "${toolName}"`;
  }
}

function sanitizeArgsForClient(args: Record<string, unknown>): Record<string, unknown> {
  // Don't expose internal IDs or large objects to the client
  return Object.fromEntries(
    Object.entries(args)
      .filter(([, v]) => typeof v !== "object" || v === null)
      .slice(0, 10)
  );
}

// ── POST /ai/chat — streaming conversational AI ───────────────────────────────
export async function chatHandler(req: Request, res: Response): Promise<void> {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Trop de requêtes — attendez avant d'envoyer un autre message" });
    return;
  }

  const { message, context, stream: wantStream = true, history = [], provider, model, enableTools } = req.body as {
    message?: string;
    context?: Record<string, unknown>;
    stream?: boolean;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    provider?: AIProviderId;
    model?: string;
    /** Phase 2 — active les outils missions pour ce message (opt-in). */
    enableTools?: boolean;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message requis" });
    return;
  }

  // ── Early attachment structure validation (sync, no DB, no provider call) ───
  // Runs before loadOrgAIPrefs so malformed attachment arrays are rejected fast.
  const rawAttachments: unknown = (req.body as Record<string, unknown>)["attachments"];
  let attachmentRefs: AIAttachmentReference[] = [];
  if (rawAttachments !== undefined) {
    const refResult = validateAttachmentReferences(rawAttachments);
    if ("code" in refResult) {
      res.status(refResult.httpStatus).json({ ok: false, code: refResult.code, message: refResult.message });
      return;
    }
    attachmentRefs = refResult;
  }

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ── AI Agents Phase 1 : identifiant de conversation (lien historique ↔ propositions) ──
  const rawConvId = (req.body as Record<string, unknown>)["conversationId"];
  const conversationId = typeof rawConvId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(rawConvId)
    ? rawConvId
    : `conv_${requestId}`;

  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "dailyAI")) {
    res.status(403).json(moduleDisabledResponse("dailyAI"));
    return;
  }

  // 1. Validate provider if explicitly provided
  if (provider !== undefined && !isValidProvider(provider)) {
    res.status(400).json({ ok: false, code: "INVALID_AI_PROVIDER" });
    return;
  }

  // 2. Resolve final provider: body.provider > org preferredProvider > "openai"
  //    Le backend ne remplace jamais un provider explicite valide.
  const resolvedProvider: AIProviderId = (provider as AIProviderId | undefined)
    ?? aiPrefs.preferredProvider
    ?? "openai";

  // 3. Validate model+provider combination if model is explicitly provided
  if (model !== undefined && !isModelValidForProvider(resolvedProvider, model)) {
    res.status(400).json({ ok: false, code: "INVALID_PROVIDER_MODEL_COMBINATION" });
    return;
  }

  // 4. Resolve model and token budget from intensity matrix — provider NEVER changes here
  const intensityCfg      = resolveIntensityConfig(resolvedProvider, aiPrefs.aiIntensity);
  const selectedProvider  = resolvedProvider;
  const requestedModel    = model ?? intensityCfg.model;
  const requestedMode     = aiPrefs.aiIntensity as AIIntensityMode;
  const baseMaxTokens     = intensityCfg.maxTokens;

  // 5. Usage + economy policy — single DB call for quota check AND economy tier
  //    EXHAUSTED (≥100%) → 402 QUOTA_EXCEEDED (credit-based, strict)
  //    Token limit exceeded → 429
  //    Otherwise → compute economy policy (model downgrade within same provider)
  let economyPolicy: ReturnType<typeof resolveEconomyPolicy>;
  let resolvedUsagePercent = 0;
  let resolvedEconomyTier: EconomyTier = "NORMAL";

  try {
    const [rawUsage, orgThresholds] = await Promise.all([
      getOrCreateMonthlyUsage(orgId),
      loadOrgEconomyThresholds(orgId),
    ]);

    const totalAvailable = rawUsage.creditsLimit + rawUsage.creditsExtra;
    const usagePercent   = totalAvailable > 0
      ? Math.min((rawUsage.creditsUsed / totalAvailable) * 100, 100)
      : 0;
    const economyTier = computeEconomyTier(usagePercent, orgThresholds);

    // Hard block on credit exhaustion — 402 per spec
    if (economyTier === "EXHAUSTED") {
      res.status(402).json({ ok: false, code: "QUOTA_EXCEEDED", economyTier: "EXHAUSTED", usagePercent: Math.round(usagePercent) });
      return;
    }

    // Token-based quota check (secondary guard)
    if (rawUsage.tokensUsed >= rawUsage.tokenLimit) {
      res.status(429).json({ error: "AI quota exceeded", used: rawUsage.tokensUsed, limit: rawUsage.tokenLimit });
      return;
    }

    resolvedUsagePercent = usagePercent;
    resolvedEconomyTier  = economyTier;
  } catch (_) {
    // DB unreachable — fail-open, NORMAL tier (safer than blocking all requests during outage)
  }

  economyPolicy = resolveEconomyPolicy({
    provider:       selectedProvider,
    requestedModel,
    requestedMode,
    baseMaxTokens,
    usagePercent:   resolvedUsagePercent,
    economyTier:    resolvedEconomyTier,
  });

  const effectiveModel     = economyPolicy.effectiveModel;
  const effectiveMaxTokens = economyPolicy.maxTokens;
  const contextFactor      = economyPolicy.contextFactor;
  const { historyLimit }   = computeContextLimits(contextFactor);

  // ── Resolve attachments from team_files (DB-scoped to org) ─────────────────
  // Runs after economy policy but BEFORE any provider call.
  let resolvedAttachments: ResolvedAIAttachment[] = [];
  if (attachmentRefs.length > 0) {
    const resolveResult = await resolveAIAttachments(req.orgDb as OrgDb, orgId, attachmentRefs);
    if ("code" in resolveResult) {
      res.status(resolveResult.httpStatus).json({ ok: false, code: resolveResult.code, message: resolveResult.message });
      return;
    }
    const aggregateError = validateResolvedAttachments(resolveResult);
    if (aggregateError) {
      res.status(aggregateError.httpStatus).json({ ok: false, code: aggregateError.code, message: aggregateError.message });
      return;
    }
    resolvedAttachments = resolveResult;
  }

  // ── Parse attachments (Steps 3B + 3C) ────────────────────────────────────
  // Local extraction — no provider call, no credit debit.
  // On parse error: structured JSON response, no SSE, no usage write.
  // Text formats (txt/json/csv/xlsx/docx/pdf) → extracted text → system prompt.
  // Images (png/jpg/jpeg/webp) → NormalizedImageAttachment → user message blocks.
  let parsedTextAttachments:  NormalizedAttachment[]      = [];
  let parsedImageAttachments: NormalizedImageAttachment[] = [];
  if (resolvedAttachments.length > 0) {
    const parseLimits = getDefaultParserLimits(contextFactor);
    const parseResult = await parseAIAttachments(resolvedAttachments, parseLimits);
    if ("code" in parseResult) {
      logger.warn({ requestId, orgId, code: parseResult.code }, "[AI] attachment parse failed");
      res.status(parseResult.httpStatus).json({ ok: false, code: parseResult.code, message: parseResult.message });
      return;
    }
    parsedTextAttachments  = parseResult.text;
    parsedImageAttachments = parseResult.images;
  }

  // 6. Build enriched _ai metadata — always tells the truth about what was used
  const aiMeta = {
    conversationId,
    provider:         selectedProvider,
    requestedModel,
    model:            effectiveModel,
    requestedMode,
    effectiveMode:    economyPolicy.effectiveMode,
    economyTier:      economyPolicy.economyTier,
    usagePercent:     Math.round(resolvedUsagePercent * 10) / 10,
    downgradeApplied: economyPolicy.downgradeApplied,
    downgradeReason:  economyPolicy.downgradeApplied ? "MONTHLY_USAGE_THRESHOLD" : null,
  };

  // Economy metadata for ai_usage_logs
  const usageMetadata: Record<string, unknown> = {
    requestedModel,
    effectiveModel,
    requestedMode,
    effectiveMode:    economyPolicy.effectiveMode,
    economyTier:      economyPolicy.economyTier,
    usagePercent:     Math.round(resolvedUsagePercent * 10) / 10,
    downgradeApplied: economyPolicy.downgradeApplied,
    ...(parsedTextAttachments.length > 0
      ? getAttachmentUsageMetadata(resolvedAttachments, parsedTextAttachments)
      : {}),
    ...getImageUsageMetadata(parsedImageAttachments),
  };

  // ── AI Agents Phase 1 : permissions effectives + plan → destinations navigables ──
  // Résolu par requête (jamais mis en cache global — leçon store.me).
  const [fpContext, effectivePerms, orgPlanRaw] = await Promise.all([
    buildFlowpointContext(context, orgId, contextFactor),
    resolveEffectivePermissions(userId, orgId, req.orgContext?.role),
    resolvePlanFromDB(req),
  ]);
  const orgPlan = (orgPlanRaw ?? "standard").toLowerCase();
  const allowedDestinations = filterDestinations(effectivePerms, orgPlan);
  const navPromptSection = buildNavPromptSection(allowedDestinations);

  // Base consultant instructions. fpContext is appended separately below so the
  // attachment block can be added in one explicit place visible to both paths.
  const systemPromptBase = `Tu es le consultant SEO senior de FlowPoint. Tu as déjà analysé le compte — les données sont dans le contexte ci-dessous. Tu connais les scores, les problèmes, les sites et l'historique.

Tu réponds en français, en consultant humain — pas en outil. Ton interlocuteur peut être un artisan, un dentiste, un restaurateur : adapte le vocabulaire à quelqu'un qui ne connaît pas le SEO.

${STRICT_AI_RULE}
=== DONNÉES RÉELLES DU COMPTE ===`;

  // Step 3B: attachment block (security-prefixed, XML-delimited).
  // Built before the messages array so it cannot diverge between stream/non-stream.
  const attachmentContext = parsedTextAttachments.length > 0
    ? buildAttachmentContextBlock(parsedTextAttachments)
    : "";

  // Single finalSystemPrompt: base instructions + real account data + attachment block.
  // All three assembled here — neither stream nor non-stream path can omit any part.
  const finalSystemPrompt = [
    systemPromptBase,
    fpContext,
    navPromptSection,
    attachmentContext,
  ].filter(Boolean).join("\n\n");

  // Single messages array shared by both paths.
  // ⚠ INJECTION FIX: the FULL array (including the system message at index 0) is
  // passed to aiStream / aiChat as opts.messages.  The provider layer uses
  // opts.messages when present and ignores opts.systemPrompt in that branch —
  // previously passing messages.slice(1) caused the provider to receive history +
  // user only, silently dropping the system prompt and all attachment content.
  // Step 3C: buildProviderMessages embeds image ContentBlock[] in the user message
  // when parsedImageAttachments.length > 0; text-only path returns string content.
  const messages: MultimodalMessage[] = buildProviderMessages({
    provider:         selectedProvider,
    systemPrompt:     finalSystemPrompt,
    history:          history.slice(-historyLimit).map(m => ({
      role:    m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    userMessage:      message,
    imageAttachments: parsedImageAttachments,
  });

  // Persist user message fire-and-forget — log failures but never block streaming
  persistChatMessage({ orgId, userId, role: "user", content: message, feature: "chat", conversationId })
    .catch(err => logger.warn({ err }, "[AI] persistChatMessage (user) failed"));

  if (wantStream) {
    // SSE streaming via unified ai-provider layer
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const t0 = Date.now();
    let fullReply = "";
    let toolLoopUndoTokens: Array<{ actionLogId: string; label: string }> = [];

    // ── AI Agents Phase 2 : boucle tool-calling (opt-in via enableTools) ──────
    // Ouvre la boucle dès que l'utilisateur possède AU MOINS une permission couverte
    // par un outil déclaré (missions.read, calendar.read, …). La vérification fine
    // par-outil est faite dans tool-executor (FAIL-CLOSED). Ne pas restreindre ici
    // à missions.read seulement : un utilisateur calendar-only doit aussi en bénéficier.
    const hasAnyToolPermission = ALL_TOOLS.some(
      (t) => effectivePerms.has(t.requiredPermission)
    );
    if (enableTools && hasAnyToolPermission) {
      const toolCtx: ExecuteContext = {
        orgId, userId, conversationId,
        provider: selectedProvider, model: effectiveModel,
        effectivePerms, orgPlan,
      };
      const loopResult = await runToolCallingLoop({
        provider: selectedProvider,
        model:    effectiveModel,
        messages: messages as import("../services/ai-multimodal.js").MultimodalMessage[],
        ctx:      toolCtx,
        sseWrite: (data) => res.write(data),
        sseClose: () => { /* no-op — caller handles close below */ },
      });
      toolLoopUndoTokens = loopResult.undoTokens;

      if (loopResult.suspended || loopResult.finalTextEmitted) {
        // Emit undo tokens before the _ai + [DONE] frame
        for (const ut of toolLoopUndoTokens) {
          res.write(`data: ${JSON.stringify({ undo_available: { actionLogId: ut.actionLogId, label: ut.label, ttlMinutes: 30 } })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ _ai: aiMeta })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        recordCompletedUsage({ feature: "chat", orgId, userId, model: effectiveModel as AIModel,
          provider: selectedProvider, tokensIn: 0, tokensOut: 0,
          latencyMs: Date.now() - t0, success: true, requestId,
          metadata: { ...usageMetadata, toolCalling: true } }).catch(() => {});
        return;
      }
      // Round 0 had no tool calls → fall through to normal aiStream below
    }

    try {
      const stream = aiStream({
        provider:      selectedProvider,
        model:         effectiveModel,
        strictProvider: true,
        systemPrompt:  finalSystemPrompt,
        messages,
        maxTokens:     effectiveMaxTokens,
      });

      // AI Agents Phase 1 : le marqueur de navigation est retenu hors du flux —
      // l'utilisateur ne voit jamais <<<FP_NAV>>>, il reçoit un événement structuré.
      const navFilter = new NavMarkerFilter();

      for await (const chunk of stream) {
        if (chunk && typeof chunk === "object" && "_aiMeta" in chunk) {
          continue; // We use our own enriched aiMeta — ignore internal routing metadata
        }
        if (chunk && typeof chunk === "object" && "content" in chunk) {
          const text = (chunk as { content: string }).content;
          fullReply += text;
          const safe = navFilter.push(text);
          if (safe) res.write(`data: ${JSON.stringify({ delta: safe })}\n\n`);
        }
      }

      const { remaining, markerJson } = navFilter.flush();
      if (remaining) res.write(`data: ${JSON.stringify({ delta: remaining })}\n\n`);

      // Validation stricte contre le registre : destination inconnue / permission
      // absente / plan insuffisant / ancre non déclarée → action abandonnée.
      if (markerJson) {
        const nav = validateNavAction(markerJson, effectivePerms, orgPlan);
        if (nav) {
          const proposal = await createNavigationProposal({
            orgId, userId, conversationId,
            provider: selectedProvider, model: effectiveModel,
            navActions: [nav],
          });
          if (proposal) res.write(`data: ${JSON.stringify({ action_proposal: proposal })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ _ai: aiMeta })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();

      const latencyMs = Date.now() - t0;
      // Step 3C: content may be ContentBlock[] for multimodal messages — only sum text lengths
      const estTokensIn  = Math.ceil(messages.reduce((s, m) => {
        const c = m.content;
        if (typeof c === "string") return s + c.length;
        return s + c.reduce((cs, b) => cs + (b.type === "text" ? b.text.length : 50), 0);
      }, 0) / 4);
      const estTokensOut = Math.ceil(fullReply.length / 4);

      persistChatMessage({ orgId, userId, role: "assistant", content: extractNavMarker(fullReply).cleanText, feature: "chat", model: effectiveModel, tokensUsed: estTokensOut, conversationId })
        .catch(err => logger.warn({ err }, "[AI] persistChatMessage (assistant) failed"));
      recordCompletedUsage({ feature: "chat", orgId, userId, model: effectiveModel as AIModel, provider: selectedProvider, tokensIn: estTokensIn, tokensOut: estTokensOut, latencyMs, success: true, requestId, metadata: usageMetadata })
        .catch(err => logger.warn({ err }, "[AI] recordCompletedUsage failed"));
    } catch (err) {
      logger.error({ err, provider: selectedProvider, model: effectiveModel }, "[AI] Streaming chat failed");
      const errCode    = (err as Record<string, unknown>)?.code;
      const errProvider = (err as Record<string, unknown>)?.provider as string | undefined;
      if (errCode === "PROVIDER_UNAVAILABLE") {
        res.write(`data: ${JSON.stringify({ ok: false, code: "PROVIDER_UNAVAILABLE", provider: errProvider ?? selectedProvider })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ error: "Erreur de generation IA" })}\n\n`);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  } else {
    // Non-streaming via unified ai-provider layer
    try {
      const t0 = Date.now();
      const result = await aiChat({
        provider:      selectedProvider,
        model:         effectiveModel,
        strictProvider: true,
        systemPrompt:  finalSystemPrompt,
        messages,
        maxTokens:     effectiveMaxTokens,
      });
      const rawReply = result.text || "Je ne peux pas repondre pour le moment.";
      const latencyMs = Date.now() - t0;

      // AI Agents Phase 1 : extraction + validation du marqueur de navigation
      const { cleanText, markerJson } = extractNavMarker(rawReply);
      const reply = cleanText || "Je ne peux pas repondre pour le moment.";
      let actionProposal = null;
      if (markerJson) {
        const nav = validateNavAction(markerJson, effectivePerms, orgPlan);
        if (nav) {
          actionProposal = await createNavigationProposal({
            orgId, userId, conversationId,
            provider: selectedProvider, model: effectiveModel,
            navActions: [nav],
          });
        }
      }

      persistChatMessage({ orgId, userId, role: "assistant", content: reply, feature: "chat", model: effectiveModel, tokensUsed: result.usage.completionTokens, conversationId })
        .catch(err => logger.warn({ err }, "[AI] persistChatMessage (assistant non-stream) failed"));
      recordCompletedUsage({ feature: "chat", orgId, userId, model: effectiveModel as AIModel, provider: selectedProvider, tokensIn: result.usage.promptTokens, tokensOut: result.usage.completionTokens, latencyMs, success: true, requestId, metadata: usageMetadata })
        .catch(err => logger.warn({ err }, "[AI] recordCompletedUsage (non-stream) failed"));
      res.json({ reply, streaming: false, action_proposal: actionProposal, _ai: aiMeta });
    } catch (err) {
      logger.error({ err, provider: selectedProvider, model: effectiveModel }, "[AI] Chat failed");
      const errCode    = (err as Record<string, unknown>)?.code;
      const errProvider = (err as Record<string, unknown>)?.provider as string | undefined;
      if (errCode === "PROVIDER_UNAVAILABLE") {
        res.status(503).json({ ok: false, code: "PROVIDER_UNAVAILABLE", provider: errProvider ?? selectedProvider });
      } else {
        res.status(503).json(aiUnavailableJson());
      }
    }
  }
}
router.post("/ai/chat", aiRateLimit, chatHandler);

// ── GET /ai/actions — liste des action logs de l'org ─────────────────────────
router.get("/ai/actions", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgId ?? "default";
  try {
    const { rows } = await pool.query(
      `SELECT id, conversation_id, tool, args, confirmation_level, result, error,
              undo_snapshot IS NOT NULL AS can_undo, undone_at, created_at
       FROM ai_action_logs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [orgId]
    );
    res.json({ actions: rows });
  } catch (err) {
    logger.error({ err, orgId }, "[agent] GET /ai/actions failed");
    res.status(500).json({ error: "Failed to load actions" });
  }
});

// ── POST /ai/actions/:id/undo — annuler une action ─────────────────────────────
router.post("/ai/actions/:id/undo", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.orgId  ?? "default";
  const userId = req.userId ?? "anonymous";
  const logId  = String(req.params["id"] ?? "");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(logId)) {
    res.status(400).json({ ok: false, error: "ID d'action invalide" });
    return;
  }
  const result = await undoAction(logId, orgId, userId);
  if (result.ok) {
    res.json(result);
    return;
  }
  // Map semantic error codes to appropriate HTTP status codes
  const statusMap: Record<string, number> = {
    NOT_FOUND:               404,
    TTL_EXPIRED:             410,
    ALREADY_UNDONE:          409,
    PROPOSAL_STALE:          409,
    UNDO_VERSION_UNAVAILABLE: 409,
  };
  const status = (result.code && statusMap[result.code]) ? statusMap[result.code] : 400;
  res.status(status).json(result);
});

// ── POST /ai/conversations/:id/confirm — exécuter une action en attente ──────
router.post("/ai/conversations/:id/confirm", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.orgId  ?? "default";
  const userId = req.userId ?? "anonymous";
  const convId = String(req.params["id"] ?? "");
  const { proposalId } = req.body as { proposalId?: string };

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(convId)) {
    res.status(400).json({ ok: false, error: "conversationId invalide" });
    return;
  }
  if (!proposalId || !/^[a-zA-Z0-9_-]{1,100}$/.test(proposalId)) {
    res.status(400).json({ ok: false, error: "proposalId requis" });
    return;
  }

  try {
    // Atomically claim the pending proposal — prevents concurrent double-execution.
    // The UPDATE only matches rows in 'pending' state that have not expired.
    // If two requests race, exactly one will get a row back; the other gets 0 rows.
    const { rows } = await pool.query(
      `UPDATE ai_action_proposals
       SET status='claimed'
       WHERE id=$1 AND org_id=$2 AND conversation_id=$3
         AND kind='pending_tool_call'
         AND status='pending'
         AND expires_at > NOW()
       RETURNING id, payload, provider, model, expires_at`,
      [proposalId, orgId, convId]
    );
    const prop = rows[0] as Record<string, unknown> | undefined;
    if (!prop) {
      // Either not found, already claimed/confirmed/expired, or wrong org — disambiguate with a read-only check
      const { rows: check } = await pool.query(
        `SELECT status, expires_at FROM ai_action_proposals WHERE id=$1 AND org_id=$2`,
        [proposalId, orgId]
      );
      if (!check[0]) {
        res.status(404).json({ ok: false, error: "Proposition introuvable" });
      } else if (new Date(check[0]["expires_at"] as string) < new Date()) {
        res.status(410).json({ ok: false, error: "Cette proposition a expiré" });
      } else {
        res.status(409).json({ ok: false, error: `Cette action est déjà dans l'état "${check[0]["status"]}"` });
      }
      return;
    }

    const payload = (typeof prop["payload"] === "string" ? JSON.parse(prop["payload"]) : prop["payload"]) as Record<string, unknown>;
    const toolName = payload["toolName"] as string;
    const toolCallId = payload["toolCallId"] as string ?? proposalId;
    const args = payload["args"] as Record<string, unknown> ?? {};

    // Resolve permissions for this user
    const effectivePerms = await resolveEffectivePermissions(userId, orgId, req.orgContext?.role);
    const orgPlan = ((await resolvePlanFromDB(req)) ?? "standard").toLowerCase();

    const toolCtx: ExecuteContext = {
      orgId, userId, conversationId: convId,
      provider: String(prop["provider"] ?? "openai"),
      model: String(prop["model"] ?? "gpt-5-mini"),
      effectivePerms, orgPlan,
    };

    const toolCall: AIToolCall = { id: toolCallId, name: toolName, arguments: args };
    const execResult = await executeTool(toolCall, toolCtx);

    // Mark proposal as confirmed
    await pool.query(
      `UPDATE ai_action_proposals SET status='confirmed' WHERE id=$1`,
      [proposalId]
    ).catch(() => {});

    res.json({
      ok: execResult.ok,
      content: execResult.content,
      data: execResult.data ?? null,
      undoToken: execResult.ok && execResult.undoLabel
        ? { actionLogId: execResult.actionLogId, label: execResult.undoLabel, ttlMinutes: 30 }
        : null,
      navProposal: execResult.navProposal ?? null,
    });
  } catch (err) {
    logger.error({ err, proposalId, orgId }, "[agent] confirm failed");
    res.status(500).json({ ok: false, error: "Erreur lors de l'exécution" });
  }
});

// ── GET /ai/destinations — registre de navigation filtré (AI Agents Phase 1) ──
// Source de vérité unique pour le frontend : mêmes permissions effectives et
// même plan que ce que voit le modèle. Jamais de route inventée côté client.
router.get("/ai/destinations", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.orgId  ?? "default";
  const userId = req.userId ?? "anonymous";
  try {
    const [perms, planRaw] = await Promise.all([
      resolveEffectivePermissions(userId, orgId, req.orgContext?.role),
      resolvePlanFromDB(req),
    ]);
    const plan = (planRaw ?? "standard").toLowerCase();
    const destinations = filterDestinations(perms, plan).map((d) => ({
      id: d.id,
      route: d.route,
      sub: d.sub,
      description: d.description,
      openModes: d.openModes,
      anchors: d.anchors,
      prefill: d.prefill,
    }));
    res.json({ version: REGISTRY_VERSION, plan, destinations });
  } catch (err) {
    logger.error({ err, orgId }, "[agent] GET /ai/destinations failed");
    res.status(500).json({ error: "Failed to load destinations" });
  }
});

// ── GET /ai/conversations/:id/timeline — historique complet d'une conversation ──
// Messages + propositions d'actions liés par conversation_id (Ajustement 10).
router.get("/ai/conversations/:id/timeline", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.orgId ?? "default";
  const convId = String(req.params["id"] ?? "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(convId)) {
    res.status(400).json({ error: "conversationId invalide" });
    return;
  }
  try {
    const [msgs, props, logs] = await Promise.all([
      pool.query(
        `SELECT id, role, content, model, created_at FROM ai_chat_history
         WHERE org_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 200`,
        [orgId, convId]
      ),
      pool.query(
        `SELECT id, kind, payload, status, provider, model, created_at, expires_at FROM ai_action_proposals
         WHERE org_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 100`,
        [orgId, convId]
      ),
      pool.query(
        `SELECT id, proposal_id, tool, args, result, error, undone_at, created_at FROM ai_action_logs
         WHERE org_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 100`,
        [orgId, convId]
      ),
    ]);
    res.json({ conversationId: convId, messages: msgs.rows, proposals: props.rows, actions: logs.rows });
  } catch (err) {
    logger.error({ err, orgId, convId }, "[agent] timeline failed");
    res.status(500).json({ error: "Failed to load timeline" });
  }
});

// ── POST /ai/audit — full technical + SEO audit analysis ─────────────────────
router.post("/ai/audit", aiRateLimit, async (req, res) => {
  const { url, scores, issues, cwv } = req.body as {
    url?: string;
    scores?: Record<string, number>;
    issues?: string[];
    cwv?: Record<string, number>;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "dailyAI")) {
    res.status(403).json(moduleDisabledResponse("dailyAI"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "audit_summary", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  // AI call uses unified provider layer below

  // Query DB for real audit record + PSI cache
  let dbAudit: Record<string, unknown> | null = null;
  let psiMobile: { titles: string[]; opportunities: string[] } = { titles: [], opportunities: [] };
  let prevScore: number | null = null;
  try {
    const [auditRes, psiRes, prevRes] = await Promise.allSettled([
      pool.query(`SELECT * FROM audits WHERE url=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 1`, [url, orgId]),
      pool.query(
        `SELECT p.critical_issues, p.opportunities
         FROM psi_cache p
         JOIN audits a ON a.url = p.url AND a.org_id = $2
         WHERE p.url=$1 AND p.strategy='mobile'
         ORDER BY p.analyzed_at DESC LIMIT 1`,
        [url, orgId]
      ),
      pool.query(
        `SELECT score FROM audits WHERE url=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 1 OFFSET 1`,
        [url, orgId]
      ),
    ]);
    if (auditRes.status === "fulfilled" && auditRes.value.rows[0]) dbAudit = auditRes.value.rows[0] as Record<string,unknown>;
    if (psiRes.status === "fulfilled" && psiRes.value.rows[0]) {
      const row = psiRes.value.rows[0] as Record<string, unknown>;
      try {
        const ci = JSON.parse(String(row["critical_issues"] ?? "[]")) as Array<{title?: string}>;
        psiMobile.titles = ci.filter(i => i.title).map(i => i.title!).slice(0, 6);
      } catch { /* ignore */ }
      try {
        const opp = JSON.parse(String(row["opportunities"] ?? "[]")) as Array<{title?: string; savings?: number}>;
        psiMobile.opportunities = opp.filter(i => i.title).map(i => `${i.title}${i.savings ? ` (~${Math.round(i.savings)}ms)` : ""}`).slice(0, 4);
      } catch { /* ignore */ }
    }
    if (prevRes.status === "fulfilled" && prevRes.value.rows[0]) prevScore = Number((prevRes.value.rows[0] as Record<string,unknown>)["score"] ?? null);
  } catch { /* ignore — use frontend-provided data as fallback */ }

  const realScore = dbAudit ? Number(dbAudit["score"] ?? 0) : (scores?.performance ?? 0);
  const realSpeed = dbAudit ? Number(dbAudit["speed"] ?? 0) : (scores?.speed ?? 0);
  const realIssuesCount = dbAudit ? Number(dbAudit["issues"] ?? 0) : (issues?.length ?? 0);
  const realIssuesList = psiMobile.titles.length > 0 ? psiMobile.titles : (issues ?? []);
  const scoreEvol = prevScore !== null ? (realScore - prevScore > 0 ? `+${realScore - prevScore}` : String(realScore - prevScore)) : null;

  const prompt = `Tu es un consultant SEO senior. Tu viens de terminer l'analyse de ${url}.

DONNÉES RÉELLES DE CET AUDIT :
Score SEO : ${realScore}/100${scoreEvol !== null ? ` (${scoreEvol} vs audit précédent)` : ""}
Score Performance : ${realSpeed}/100
Problèmes critiques détectés : ${realIssuesCount}
Core Web Vitals : ${JSON.stringify(cwv ?? {})}
Issues PSI réelles : ${realIssuesList.length > 0 ? realIssuesList.join(" | ") : "non disponibles"}
Opportunités d'optimisation : ${psiMobile.opportunities.length > 0 ? psiMobile.opportunities.join(" | ") : "voir issues"}

Génère ton analyse exactement dans ce format :

Audit terminé.
Score SEO : ${realScore}/100
Performance : ${realSpeed}/100
Problèmes critiques : ${realIssuesCount}

Ces problèmes représentent actuellement la plus forte perte de score.

[Pour CHAQUE problème critique identifié, génère un bloc :]

Priorité N
────────────
[Nom exact du problème]

Pourquoi :
[Explication technique précise, pourquoi ça pénalise le score]

Où corriger :
[Section ou page précise sur ${url}]

Impact estimé :
+X points SEO

Temps :
X minutes / X heures

Après ces corrections je recommande :
1. Relancer un audit complet.
2. [Action 2 spécifique aux données]
3. [Action 3 spécifique aux données]`;

  const systemPrompt = `Tu es un consultant SEO senior intégré à FlowPoint. Tu as déjà analysé le site — réponds directement avec les résultats concrets, jamais de formules génériques. Chaque problème doit citer des données réelles. N'invente aucun chiffre. Si une donnée manque, dis-le en une ligne et continue.`;

  try {
    const aiResult = await callAIWithFallback({
      task: "seo_audit",
      systemPrompt,
      userPrompt: prompt,
      maxTokens: 1400,
      temperature: 0.4,
      orgId,
    });
    const { remaining: auditRemaining } = await recordCompletedUsage({ feature: "audit_summary", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ analysis: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: auditRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /audit failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/seo — SEO recommendations ───────────────────────────────────────
router.post("/ai/seo", aiRateLimit, async (req, res) => {
  const { url, keywords, currentScore, context } = req.body as {
    url?: string;
    keywords?: string[];
    currentScore?: number;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiCRO")) {
    res.status(403).json(moduleDisabledResponse("aiCRO"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "cro_analysis", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  // AI call uses unified provider layer below

  // Read real data from DB
  const fpCtx = await buildFlowpointContext(context, orgId);
  let realScore = currentScore ?? 0;
  let realSpeed = 0;
  let realIssues: string[] = [];
  let dbKeywords: string[] = [];
  try {
    const [auditRes, psiRes, kwRes] = await Promise.allSettled([
      pool.query(`SELECT score, speed, issues FROM audits WHERE url=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 1`, [url, orgId]),
      pool.query(
        `SELECT p.critical_issues FROM psi_cache p
         JOIN audits a ON a.url = p.url AND a.org_id = $2
         WHERE p.url=$1 AND p.strategy='mobile'
         ORDER BY p.analyzed_at DESC LIMIT 1`,
        [url, orgId]
      ),
      pool.query(`SELECT keyword, current_position, prev_position, position_change, search_volume FROM tracked_keywords WHERE org_id=$1 AND active=true ORDER BY search_volume DESC NULLS LAST LIMIT 10`, [orgId]),
    ]);
    if (auditRes.status === "fulfilled" && auditRes.value.rows[0]) {
      const r = auditRes.value.rows[0] as Record<string,unknown>;
      realScore = Number(r["score"] ?? currentScore ?? 0);
      realSpeed = Number(r["speed"] ?? 0);
    }
    if (psiRes.status === "fulfilled" && psiRes.value.rows[0]) {
      try {
        const ci = JSON.parse(String((psiRes.value.rows[0] as Record<string,unknown>)["critical_issues"] ?? "[]")) as Array<{title?: string}>;
        realIssues = ci.filter(i => i.title).map(i => i.title!).slice(0, 5);
      } catch { /* ignore */ }
    }
    if (kwRes.status === "fulfilled") {
      const kwRows = kwRes.value.rows as Array<{keyword: string; current_position: number | null; prev_position: number | null; position_change: number | null; search_volume: number | null}>;
      if (kwRows.length > 0) {
        dbKeywords = kwRows.map(k => {
          const delta = k.position_change;
          const deltaStr = delta != null ? (delta > 0 ? ` ▲${delta}` : delta < 0 ? ` ▼${Math.abs(delta)}` : "") : "";
          return `${k.keyword}${k.current_position ? ` (pos ${k.current_position}${deltaStr})` : ""}`;
        });
      }
    }
  } catch { /* use provided data */ }
  // Merge: DB keywords take precedence over frontend-provided
  const effectiveKeywords = dbKeywords.length > 0 ? dbKeywords : (keywords ?? []);

  const prompt = `Tu es consultant SEO senior pour ${url}.

DONNÉES RÉELLES :
Score SEO actuel : ${realScore}/100
Score Performance : ${realSpeed}/100
Issues critiques PSI : ${realIssues.length > 0 ? realIssues.join(" | ") : "non disponibles"}
Mots-clés suivis : ${effectiveKeywords.join(", ") || "aucun suivi actif"}

Contexte du compte :
${fpCtx}

Génère des recommandations SEO prioritaires ancrées sur ces données réelles.
Pour chaque recommandation :
🔴 Critique / 🟡 Important / 🟢 Bonus
- Cite l'issue réelle ou le score exact concerné
- Donne un impact estimé en points SEO ou % trafic
- Estime le temps de correction

Sections :
1. **Problèmes critiques à corriger en priorité** (basé sur les issues PSI réelles)
2. **Optimisation mots-clés** (basé sur les positions réelles)
3. **Performance & Core Web Vitals** (basé sur le score ${realSpeed}/100)
4. **Autorité & maillage**
5. **Prochaines étapes recommandées**`;

  try {
    const t0 = Date.now();
    const aiCfg = await selectOptimalModel("cro_analysis", orgId);
    const resp = await aiChat({
      provider: aiCfg.provider,
      model: aiCfg.model,
      systemPrompt: `Tu es un consultant SEO senior. Tu as accès aux données réelles du site. Chaque recommandation doit citer les chiffres exacts fournis — jamais de généralités.`,
      messages: [{ role: "user", content: prompt }],
      maxTokens: aiCfg.maxTokens,
    });
    const recommendations = resp.text ?? "";
    const latencyMs = Date.now() - t0;
    const { remaining: seoRemaining } = await recordCompletedUsage({ feature: "cro_analysis", orgId, userId, model: resp._ai.model as AIModel, provider: resp._ai.provider, tokensIn: resp.usage.promptTokens, tokensOut: resp.usage.completionTokens, latencyMs, success: true, requestId });
    res.json({ recommendations, _ai: resp._ai, creditsRemaining: seoRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /seo failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/conversion — CRO & conversion analysis ──────────────────────────
router.post("/ai/conversion", aiRateLimit, async (req, res) => {
  const { url, metrics, funnel } = req.body as {
    url?: string;
    metrics?: Record<string, unknown>;
    funnel?: unknown[];
    context?: Record<string, unknown>;
  };

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiCRO")) {
    res.status(403).json(moduleDisabledResponse("aiCRO"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "cro_analysis", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  // AI call uses unified provider layer below

  const fpCtx = await buildFlowpointContext(undefined, orgId);
  const prompt = `Analyse CRO (Conversion Rate Optimization) pour ${url ?? "le site"}.
Métriques: ${JSON.stringify(metrics ?? {})}
Funnel: ${JSON.stringify(funnel ?? [])}
Contexte: ${fpCtx}

Analyse en 4 sections:
1. **Points de friction identifiés** (avec impact estimé)
2. **Opportunités CRO quick wins** (< 1 semaine d'implémentation)
3. **Tests A/B recommandés** (hypothèse + métrique à mesurer)
4. **Impact revenue estimé** (+X% conversion → +€Y/mois)`;

  try {
    const aiResult = await callAIWithFallback({
      task: "cro_analysis",
      systemPrompt: "Tu es un expert CRO et UX. Réponds en français avec des recommandations concrètes.",
      userPrompt: prompt,
      maxTokens: 1000,
      orgId,
    });
    const { remaining: convRemaining } = await recordCompletedUsage({ feature: "cro_analysis", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ analysis: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: convRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /conversion failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/local — Local SEO recommendations ────────────────────────────────
router.post("/ai/local", aiRateLimit, async (req, res) => {
  const { business, location, keywords, gbpData } = req.body as {
    business?: string;
    location?: string;
    keywords?: string[];
    gbpData?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiMarket")) {
    res.status(403).json(moduleDisabledResponse("aiMarket"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "market_intel", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  // AI call uses unified provider layer below

  const prompt = `Stratégie Local SEO pour ${business ?? "l'entreprise"} à ${location ?? "France"}.
Mots-clés locaux: ${(keywords ?? []).join(", ") || "non fournis"}
Données GBP: ${JSON.stringify(gbpData ?? {})}

Génère une stratégie Local SEO complète:
1. **Optimisation Google Business Profile** (5 actions prioritaires)
2. **Citations & NAP** (annuaires locaux clés)
3. **Avis clients** (stratégie obtention + réponse)
4. **Contenu local** (pages à créer, mots-clés)
5. **Backlinks locaux** (sources à cibler)
6. **Plan 90 jours** avec jalons`;

  try {
    const aiResult = await callAIWithFallback({
      task: "market_intel",
      systemPrompt: "Tu es un expert Local SEO et Google Business Profile. Réponds en français.",
      userPrompt: prompt,
      maxTokens: 1200,
      orgId,
    });
    const { remaining: localRemaining } = await recordCompletedUsage({ feature: "market_intel", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ recommendations: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: localRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /local failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/competitors — Competitor analysis ────────────────────────────────
router.post("/ai/competitors", aiRateLimit, async (req, res) => {
  const { competitors, ourUrl, ourScore } = req.body as {
    competitors?: Array<{ name: string; url?: string; rating?: number }>;
    ourUrl?: string;
    ourScore?: number;
    context?: Record<string, unknown>;
  };

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiMarket")) {
    res.status(403).json(moduleDisabledResponse("aiMarket"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "market_intel", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  // AI call uses unified provider layer below

  const prompt = `Analyse concurrentielle pour ${ourUrl ?? "notre site"} (score SEO: ${ourScore ?? "?"}/100).
Concurrents: ${JSON.stringify(competitors ?? [])}

Fournis:
1. **Analyse des gaps** (ce qu'ils font mieux que nous)
2. **Avantages concurrentiels** à exploiter
3. **Opportunités de mots-clés** qu'ils ne couvrent pas
4. **Stratégie de contenu** pour les dépasser
5. **Estimation de temps** pour rattraper le leader`;

  try {
    const aiResult = await callAIWithFallback({
      task: "market_intel",
      systemPrompt: "Tu es un analyste stratégique SEO. Réponds en français avec des insights actionnables.",
      userPrompt: prompt,
      maxTokens: 1200,
      orgId,
    });
    const { remaining: compRemaining } = await recordCompletedUsage({ feature: "market_intel", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ analysis: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: compRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /competitors failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/reports — AI report generation ───────────────────────────────────
router.post("/ai/reports", aiRateLimit, async (req, res) => {
  const { reportType, period, sites, metrics } = req.body as {
    reportType?: string;
    period?: string;
    sites?: string[];
    metrics?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiReporting")) {
    res.status(403).json(moduleDisabledResponse("aiReporting"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "report_gen", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  const fpCtx = await buildFlowpointContext(undefined, orgId);

  // Dynamic period + score evolution
  const now = new Date();
  const monthNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const dynamicPeriod = period ?? `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevPeriodStart = prevMonth.toISOString().slice(0, 10);
  let scoreEvolution = "";
  try {
    const evoRes = await pool.query(
      `SELECT
         (SELECT ROUND(AVG(score)) FROM audits
          WHERE org_id=$1
            AND created_at >= date_trunc('month', now())) AS avg_current,
         (SELECT ROUND(AVG(score)) FROM audits
          WHERE org_id=$1
            AND created_at >= date_trunc('month', now() - INTERVAL '1 month')
            AND created_at < date_trunc('month', now())) AS avg_prev`,
      [orgId]
    );
    if (evoRes.rows[0]) {
      const r = evoRes.rows[0] as Record<string,unknown>;
      const cur = r["avg_current"] != null ? Number(r["avg_current"]) : null;
      const prev = r["avg_prev"] != null ? Number(r["avg_prev"]) : null;
      if (cur !== null && prev !== null && prev > 0) {
        const delta = cur - prev;
        scoreEvolution = `Évolution score moyen : ${cur}/100 ce mois (${delta >= 0 ? "+" : ""}${delta} vs mois précédent ${prev}/100)`;
      } else if (cur !== null) {
        scoreEvolution = `Score moyen ce mois : ${cur}/100 (pas d'historique mois précédent)`;
      }
    }
  } catch { /* ignore */ }

  const prompt = `Génère un rapport ${reportType ?? "SEO mensuel"} pour la période ${dynamicPeriod}.
Sites analysés : ${(sites ?? []).join(", ") || "selon les audits en base"}
${scoreEvolution ? scoreEvolution + "\n" : ""}Métriques additionnelles : ${JSON.stringify(metrics ?? {})}

=== DONNÉES RÉELLES DU COMPTE ===
${fpCtx}

Génère le rapport comme un consultant senior qui présente les résultats à son client. Cite UNIQUEMENT les chiffres réels ci-dessus.

# Résumé Exécutif
(2-3 phrases avec les vrais chiffres : score actuel, évolution, nombre d'issues)

# Points Forts — ${dynamicPeriod}
(3-5 victoires avec chiffres exacts issus du contexte)

# Problèmes Prioritaires
(3-5 points avec : nom du problème, URL concernée, impact estimé, délai de correction)

# Plan d'Actions — 30 prochains jours
(Actions ordonnées par priorité, avec responsable suggéré et délai)

# Prévisions Mois Prochain
(Objectifs SMART basés sur l'état actuel)`;

  try {
    const aiResult = await callAIWithFallback({
      task: "executive_report",
      systemPrompt: "Tu es un consultant SEO senior. Tu génères des rapports basés UNIQUEMENT sur les données réelles fournies. Cite les chiffres exacts. Jamais de généralités ou de données inventées. Format markdown professionnel, français formel.",
      userPrompt: prompt,
      maxTokens: 1800,
      orgId,
    });
    const { remaining: repRemaining } = await recordCompletedUsage({ feature: "report_gen", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ report: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: repRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /reports failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/summary — Executive summary ──────────────────────────────────────
router.post("/ai/summary", aiRateLimit, async (req, res) => {
  const { context } = req.body as { context?: Record<string, unknown> };
  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiStrategist")) {
    res.status(403).json(moduleDisabledResponse("aiStrategist"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "strategist", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  const fpCtx = await buildFlowpointContext(context, orgId);

  const prompt = `Génère un résumé exécutif de la situation SEO et web pour ce compte Flowpoint.
Données: ${fpCtx}
Données additionnelles: ${JSON.stringify(context ?? {})}

Format:
## Situation Actuelle
## Points Critiques (max 3)
## Opportunités Immédiates (top 3 quick wins)
## Recommandation Stratégique
## Prévision 3 mois`;

  try {
    const aiResult = await callAIWithFallback({
      task: "strategist",
      systemPrompt: "Tu es un directeur stratégique digital. Résumé concis, chiffré, actionnable. Français.",
      userPrompt: prompt,
      maxTokens: 1600,
      orgId,
    });
    const { remaining: sumRemaining } = await recordCompletedUsage({ feature: "strategist", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ summary: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: sumRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /summary failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/missions — AI mission generation ─────────────────────────────────
router.post("/ai/missions", aiRateLimit, async (req, res) => {
  const { profile, currentMissions, context } = req.body as {
    profile?: Record<string, unknown>;
    currentMissions?: unknown[];
    context?: Record<string, unknown>;
  };

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "dailyAI")) {
    res.status(403).json(moduleDisabledResponse("dailyAI"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "mission_auto", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  const fpCtx = await buildFlowpointContext(context, orgId);

  const prompt = `Tu es consultant SEO senior. Génère 6 missions SEO prioritaires basées UNIQUEMENT sur les données réelles ci-dessous.

=== DONNÉES RÉELLES ===
${fpCtx}

Profil additionnel : ${JSON.stringify(profile ?? {})}
Missions déjà en cours : ${JSON.stringify((currentMissions ?? []).slice(0, 3))}

RÈGLES IMPORTANTES :
- Chaque mission doit être ancrée à un problème réel cité dans les données (URL précise, score réel, issue réelle).
- Pas de missions génériques du type "optimiser les images" sans référencer le site concerné.
- Calcule expectedGain à partir des scores réels (ex: si score=40/100, corriger les issues critiques = +15 à +25 pts).
- Ordonne par priorité décroissante : les issues les plus bloquantes en premier.
- N'inclus pas une mission déjà "en cours" dans la liste.

Retourne un JSON array de 6 missions :
{
  "title": "string (court, spécifique — cite le site ou le problème exact)",
  "description": "string (2-3 phrases, cite les chiffres réels)",
  "category": "seo|performance|content|local|conversion|technical",
  "priority": 1-10,
  "estimatedImpact": "Faible|Moyen|Élevé|Critique",
  "estimatedEffort": "1h|4h|1j|1sem|2sem",
  "expectedGain": "string (ex: +12 points SEO, +20% trafic)"
}

Réponds uniquement avec le JSON array.`;

  try {
    const aiResult = await callAIWithFallback({
      task: "mission_auto",
      systemPrompt: "Tu génères des missions SEO JSON structurées. Réponds UNIQUEMENT avec du JSON valide, aucun autre texte.",
      userPrompt: prompt,
      maxTokens: 1000,
      json: true,
      orgId,
    });
    let missions: unknown[];
    try {
      const parsed = JSON.parse(aiResult.text);
      missions = Array.isArray(parsed) ? parsed : (parsed.missions ?? []);
    } catch {
      missions = [];
    }
    if (missions.length === 0) {
      res.status(503).json(aiUnavailableJson());
      return;
    }
    const { remaining: missRemaining } = await recordCompletedUsage({ feature: "mission_auto", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ missions, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: missRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /missions failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── POST /ai/pagespeed-insights — AI analysis of PSI data ────────────────────
router.post("/ai/pagespeed-insights", aiRateLimit, async (req, res) => {
  const { url, mobile, desktop } = req.body as {
    url?: string;
    mobile?: Record<string, unknown>;
    desktop?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "dailyAI")) {
    res.status(403).json(moduleDisabledResponse("dailyAI"));
    return;
  }
  const quotaCheck = await checkAIQuota({ feature: "audit_summary", orgId });
  if (!quotaCheck.allowed) { res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs)); return; }

  // AI call uses unified provider layer below

  const prompt = `Analyse les résultats PageSpeed Insights pour ${url} et génère des recommandations d'optimisation.

Performance Mobile: ${mobile?.scores ? JSON.stringify(mobile.scores) : "N/A"}
CWV Mobile: ${mobile?.cwv ? JSON.stringify(mobile.cwv) : "N/A"}
Opportunités Mobile: ${JSON.stringify((mobile?.opportunities as unknown[] ?? []).slice(0, 5))}

Performance Desktop: ${desktop?.scores ? JSON.stringify(desktop.scores) : "N/A"}
Problèmes critiques: ${JSON.stringify(mobile?.criticalIssues ?? [])}

Génère:
1. **Diagnostic** (état actuel en 2 phrases)
2. **3 Optimisations Critiques** (impact immédiat, avec code si pertinent)
3. **Plan d'amélioration** (étapes ordonnées par priorité)
4. **Gains attendus** (estimation score après optimisations)`;

  try {
    const aiResult = await callAIWithFallback({
      task: "seo_audit",
      systemPrompt: "Tu es un expert performance web (Core Web Vitals, PageSpeed). Réponds en français avec des actions concrètes et du code si nécessaire.",
      userPrompt: prompt,
      maxTokens: 1200,
      orgId,
    });
    const { remaining: psiRemaining } = await recordCompletedUsage({ feature: "audit_summary", orgId, userId, model: aiResult.model as AIModel, provider: aiResult.provider, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, requestId });
    res.json({ recommendations: aiResult.text, model: aiResult.model, provider: aiResult.provider, _ai: aiResult._ai, creditsRemaining: psiRemaining });
  } catch (err) {
    logger.error({ err }, "[AI] /pagespeed-insights failed");
    res.status(503).json(aiUnavailableJson());
  }
});

// ── GET /ai/usage — real credit usage from DB ────────────────────────────────
router.get("/ai/usage", async (req, res) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    const resetDate = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      1,
    ).toISOString();
    res.json({
      used:         stats.monthly.creditsUsed,
      limit:        stats.monthly.creditsLimit,
      extra:        stats.monthly.creditsExtra,
      costEur:      stats.monthly.costEur,
      requestCount: stats.monthly.requestCount,
      remaining:    Math.max(0, stats.monthly.creditsLimit + stats.monthly.creditsExtra - stats.monthly.creditsUsed),
      resetDate,
      byFeature:    stats.byFeature,
      byProvider:   stats.byProvider,
      byModel:      stats.byModel,
      dailyHistory: stats.dailyHistory,
      alerts:       stats.alerts,
      estimatedCostEur: stats.estimatedCostEur,
    });
  } catch (err) {
    logger.error({ err }, "[AI] /ai/usage failed");
    res.status(500).json({ error: "Impossible de lire l'usage IA" });
  }
});


router.get("/ai/recommendations", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, type, title, description, priority, status, source, metadata, created_at, expires_at
       FROM ai_recommendations
       WHERE org_id = $1
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY priority ASC, created_at DESC
       LIMIT 50`,
      [orgId]
    );
    res.json({ recommendations: rows });
  } catch (err) {
    logger.warn({ err }, "[AI] /ai/recommendations query failed — returning empty");
    res.json({ recommendations: [] });
  } finally {
    client.release();
  }
});

router.post("/ai/generate", aiRateLimit, async (req: Request, res: Response) => {
  const { prompt, type = "general" } = req.body as { prompt?: string; type?: string };
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const orgId     = req.orgId  ?? "default";
  const userId    = req.userId ?? "anonymous";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Pre-flight quota check — /ai/generate calls a paid AI provider
  const quotaCheck = await checkAIQuota({ feature: "chat", orgId });
  if (!quotaCheck.allowed) {
    const aiPrefs = await loadOrgAIPrefs(orgId);
    return res.status(402).json(buildQuotaGuidance(quotaCheck, aiPrefs));
  }

  const t0 = Date.now();
  try {
    const result = await aiChat({
      task: "chat",
      systemPrompt: `Tu es un assistant marketing expert. Type de contenu: ${type}. Réponds en français, de façon professionnelle et directement utilisable.`,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 800,
    });
    const latencyMs = Date.now() - t0;

    recordCompletedUsage({
      feature: "chat", orgId, userId,
      model: (result._ai.model) as AIModel, provider: result._ai.provider,
      tokensIn: result.usage.promptTokens, tokensOut: result.usage.completionTokens,
      latencyMs, success: true, requestId,
    }).catch(err => logger.warn({ err }, "[AI] /generate recordCompletedUsage failed"));

    res.json({
      content: result.text,
      mock: false,
      _ai: result._ai,
    });
  } catch (err) {
    logger.error({ err }, "[AI] /ai/generate failed");
    return res.status(503).json({
      error: "Service IA temporairement indisponible. Réessayez dans quelques instants.",
      code: "AI_UNAVAILABLE",
    });
  }
});

export default router;
