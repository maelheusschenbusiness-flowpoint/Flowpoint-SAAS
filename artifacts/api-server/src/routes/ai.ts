import { Router, type Request, type Response } from "express";
import { pool, db, auditsTable, monitorsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { aiRateLimit } from "../middlewares/rateLimiter.js";
import {
  consumeAICredits,
  trackAIUsage,
  getAIUsageStats,
  getOrCreateMonthlyUsage,
  recordCompletedUsage,
  type AIFeature,
} from "../services/ai-engine.js";
import {
  loadOrgAIPrefs,
  checkModuleEnabled,
  moduleDisabledResponse,
  selectOptimalModel,
  resolveAIModel,
  type AIModuleKey,
} from "../services/ai-prefs.js";
import { aiChat, aiStream, checkAllProviders, type AIProviderId } from "../services/ai-provider.js";

const router = Router();
// Apply AI rate limit to all routes in this router (org-based, plan-aware)
router.use(aiRateLimit);

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
  fallbackText: string;
  orgId?: string;
}): Promise<{ text: string; model: string; provider: AIProviderId; tokensIn: number; tokensOut: number; latencyMs: number }> {
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
      text: result.text || args.fallbackText,
      model,
      provider,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logger.error({ err, task: args.task, provider, model }, "[AI] callAIWithFallback failed — returning fallback");
    return {
      text: args.fallbackText,
      model,
      provider,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
    };
  }
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

async function buildFlowpointContext(extra?: Record<string, unknown>, orgId?: string): Promise<string> {
  try {
    const oid = orgId ?? "default";
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
           LIMIT 15`,
          [oid]
        ),
        pool.query(
          `SELECT name, url, domain_rating, keywords AS kw_count
           FROM competitors WHERE org_id=$1 ORDER BY domain_rating DESC LIMIT 5`,
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
        .limit(10),
      db.select().from(monitorsTable)
        .where(eq(monitorsTable.orgId, oid))
        .limit(10),
    ]);

    // Fetch real PSI critical issues for top 5 audited URLs
    if (audits.length > 0) {
      const urls = audits.slice(0, 5).map(a => a.url);
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
    const missAct      = (e["missionsActive"] as number) ?? 0;
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
        ? `Tous les audits : ${audits.slice(0, 5).map(a =>
            `${a.url} score=${a.score}/100 perf=${a.speed ?? "?"}/100 issues=${a.issues}`
          ).join(" | ")}`
        : "Aucun audit effectué",
      ``,
      `=== PROBLÈMES RÉELS DÉTECTÉS (PSI) PAR CATÉGORIE ===`,
      ...audits.slice(0, 5).flatMap(a => {
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
        ? `Mots-clés suivis (${allKw.length}) : ${allKw.slice(0, 10).map(k =>
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
      topCroRecs.length > 0 ? `Recommandations CRO : ${topCroRecs.join(" / ")}` : "",
      revLeak > 0 ? `Fuites de revenus détectées : ${revLeak}` : "",
      ``,
      `=== ACTIVITÉ RÉCENTE ===`,
      recentAct.length > 0 ? recentAct.join(" | ") : "Aucune activité récente",
      aiCredits != null ? `Crédits IA restants : ${aiCredits}` : "",
    ];

    return lines.filter(l => l !== "").join("\n");
  } catch {
    return `Platform: Flowpoint SaaS SEO Dashboard. Plan: ${store.me.plan ?? "Pro"}.`;
  }
}

// Strict instruction inserted into every system prompt to prevent hallucinated generic advice
const STRICT_AI_RULE = `
RÈGLES ABSOLUES DU CONSULTANT SEO SENIOR:
1. Tu connais déjà le site du client — ne demande jamais des données disponibles dans le contexte.
2. Cite TOUJOURS les chiffres réels : score exact, URL exacte, position exacte, nombre d'issues.
3. Ne dis JAMAIS "je ne peux pas deviner", "copiez-collez vos erreurs", "autorisez-moi" — tu as accès à tout.
4. N'invente JAMAIS de données (sessions, backlinks, taux de rebond) absentes du contexte.
5. Formate toujours les recommandations prioritaires en blocs :
   Priorité N — [Nom du problème]
   Pourquoi : [explication ancrée aux chiffres réels]
   Où corriger : [URL ou section précise]
   Impact estimé : +X pts SEO (ou +X% trafic)
   Temps estimé : X minutes / X heures
6. Si GSC/GA4/GBP ne sont pas connectés, mentionne-le APRÈS les recommandations principales — pas avant.
7. Si une donnée manque vraiment, signale-le en une ligne et continue avec ce qui est disponible.
8. Termine TOUJOURS par "Après ces corrections, je recommande : …" avec les 3 prochaines étapes.
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
}): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      const id = `ach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await client.query(`
        INSERT INTO ai_chat_history (id, org_id, user_id, role, content, feature, model, tokens_used)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, opts.orgId, opts.userId, opts.role, opts.content, opts.feature, opts.model ?? "gpt-5-mini", opts.tokensUsed ?? 0]);
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

// ── POST /ai/chat — streaming conversational AI ───────────────────────────────
router.post("/ai/chat", async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Trop de requêtes — attendez avant d'envoyer un autre message" });
    return;
  }

  const { message, context, stream: wantStream = true, history = [], provider, model } = req.body as {
    message?: string;
    context?: Record<string, unknown>;
    stream?: boolean;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    provider?: AIProviderId;
    model?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message requis" });
    return;
  }

  const orgId  = req.orgId  ?? "default";
  const userId = req.userId ?? "anonymous";

  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiAlerts")) {
    res.status(403).json(moduleDisabledResponse("aiAlerts"));
    return;
  }

  // 1. Resolve provider + model: explicit > task-based > default (OpenAI)
  const selectedProvider = provider ?? "openai";
  let selectedModel = model;
  if (!selectedModel) {
    // Use task router for chat defaults
    const { resolveTaskProvider } = await import("../services/ai-providers/task-router.js");
    const resolved = resolveTaskProvider("chat", selectedProvider);
    selectedModel = resolved.model;
  }

  // 2. Token-based quota check — strict pre-flight against monthly token budget
  //    If DB is unavailable getOrCreateMonthlyUsage() throws and we allow the request
  //    (fail-open is safer than silently blocking every call during a DB outage)
  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    if (usage.tokensUsed >= usage.tokenLimit) {
      res.status(429).json({ error: "AI quota exceeded", used: usage.tokensUsed, limit: usage.tokenLimit });
      return;
    }
  } catch (_) {
    // DB unreachable — fail-open; usage will be recorded when DB recovers
  }

  const fpContext = await buildFlowpointContext(context, orgId);
  const systemPrompt = `Tu es le consultant SEO senior intégré à FlowPoint. Tu connais déjà le site du client, ses scores, ses problèmes et son historique — tout est dans le contexte ci-dessous.
Ton rôle : analyser les données réelles et répondre comme un expert qui a étudié le dossier avant la réunion.
- Cite toujours les chiffres exacts du contexte (score, URL, position, nombre d'issues).
- Formule des recommandations prioritaires numérotées avec impact estimé (+X pts) et temps estimé.
- Ne demande jamais à l'utilisateur de te fournir des informations déjà présentes.
- Réponds en français, structuré avec ** pour le gras.
${STRICT_AI_RULE}
=== DONNÉES RÉELLES DU COMPTE ===
${fpContext}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // Persist user message fire-and-forget — log failures but never block streaming
  persistChatMessage({ orgId, userId, role: "user", content: message, feature: "chat" })
    .catch(err => logger.warn({ err }, "[AI] persistChatMessage (user) failed"));

  if (wantStream) {
    // SSE streaming via unified ai-provider layer
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const t0 = Date.now();
    let fullReply = "";

    try {
      const stream = aiStream({
        provider: selectedProvider,
        model: selectedModel,
        systemPrompt: messages[0]!.content,
        messages: messages.slice(1),
        maxTokens: 800,
      });

      for await (const chunk of stream) {
        if (chunk && typeof chunk === "object" && "content" in chunk) {
          const text = (chunk as { content: string }).content;
          fullReply += text;
          res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
        }
      }
      res.write(`data: [DONE]\n\n`);
      res.end();

      const latencyMs = Date.now() - t0;
      const estTokensIn = Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
      const estTokensOut = Math.ceil(fullReply.length / 4);

      persistChatMessage({ orgId, userId, role: "assistant", content: fullReply, feature: "chat", model: selectedModel, tokensUsed: estTokensOut })
        .catch(err => logger.warn({ err }, "[AI] persistChatMessage (assistant) failed"));
      recordCompletedUsage({ feature: "chat", orgId, userId, model: selectedModel, provider: selectedProvider, tokensIn: estTokensIn, tokensOut: estTokensOut, latencyMs, success: true })
        .catch(err => logger.warn({ err }, "[AI] recordCompletedUsage failed"));
    } catch (err) {
      logger.error({ err, provider: selectedProvider, model: selectedModel }, "[AI] Streaming chat failed");
      res.write(`data: ${JSON.stringify({ error: "Erreur de generation IA" })}\n\n`);
      res.end();
    }
  } else {
    // Non-streaming via unified ai-provider layer
    try {
      const t0 = Date.now();
      const result = await aiChat({
        provider: selectedProvider,
        model: selectedModel,
        systemPrompt: messages[0]!.content,
        messages: messages.slice(1),
        maxTokens: 800,
      });
      const reply = result.text || "Je ne peux pas repondre pour le moment.";
      const latencyMs = Date.now() - t0;

      persistChatMessage({ orgId, userId, role: "assistant", content: reply, feature: "chat", model: selectedModel, tokensUsed: result.usage.completionTokens })
        .catch(err => logger.warn({ err }, "[AI] persistChatMessage (assistant non-stream) failed"));
      recordCompletedUsage({ feature: "chat", orgId, userId, model: selectedModel, provider: selectedProvider, tokensIn: result.usage.promptTokens, tokensOut: result.usage.completionTokens, latencyMs, success: true })
        .catch(err => logger.warn({ err }, "[AI] recordCompletedUsage (non-stream) failed"));
      res.json({ reply, streaming: false, provider: selectedProvider, model: selectedModel });
    } catch (err) {
      logger.error({ err, provider: selectedProvider, model: selectedModel }, "[AI] Chat failed");
      res.status(500).json({ error: "Erreur IA - reessayez" });
    }
  }
});

// ── POST /ai/audit — full technical + SEO audit analysis ─────────────────────
router.post("/ai/audit", async (req, res) => {
  const { url, scores, issues, cwv } = req.body as {
    url?: string;
    scores?: Record<string, number>;
    issues?: string[];
    cwv?: Record<string, number>;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiAlerts")) {
    res.status(403).json(moduleDisabledResponse("aiAlerts"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "audit_summary", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: buildFallbackAudit(url, scores),
      orgId,
    });
    await trackAIUsage({ feature: "audit_summary", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ analysis: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /audit failed");
    res.json({ analysis: buildFallbackAudit(url, scores) });
  }
});

// ── POST /ai/seo — SEO recommendations ───────────────────────────────────────
router.post("/ai/seo", async (req, res) => {
  const { url, keywords, currentScore, context } = req.body as {
    url?: string;
    keywords?: string[];
    currentScore?: number;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiCRO")) {
    res.status(403).json(moduleDisabledResponse("aiCRO"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "cro_analysis", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
    await trackAIUsage({ feature: "cro_analysis", orgId, model: aiCfg.model, tokensIn: resp.usage.promptTokens, tokensOut: resp.usage.completionTokens, latencyMs, success: true, provider: aiCfg.provider });
    res.json({ recommendations, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /seo failed");
    res.json({ recommendations: buildFallbackSEO(url) });
  }
});

// ── POST /ai/conversion — CRO & conversion analysis ──────────────────────────
router.post("/ai/conversion", async (req, res) => {
  const { url, metrics, funnel } = req.body as {
    url?: string;
    metrics?: Record<string, unknown>;
    funnel?: unknown[];
    context?: Record<string, unknown>;
  };

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiCRO")) {
    res.status(403).json(moduleDisabledResponse("aiCRO"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "cro_analysis", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: "Analyse CRO temporairement indisponible.",
      orgId,
    });
    await trackAIUsage({ feature: "cro_analysis", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ analysis: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /conversion failed");
    res.status(500).json({ error: "Erreur analyse CRO" });
  }
});

// ── POST /ai/local — Local SEO recommendations ────────────────────────────────
router.post("/ai/local", async (req, res) => {
  const { business, location, keywords, gbpData } = req.body as {
    business?: string;
    location?: string;
    keywords?: string[];
    gbpData?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiMarket")) {
    res.status(403).json(moduleDisabledResponse("aiMarket"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "market_intel", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: "Recommandations Local SEO temporairement indisponibles.",
      orgId,
    });
    await trackAIUsage({ feature: "market_intel", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ recommendations: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /local failed");
    res.status(500).json({ error: "Erreur recommandations Local SEO" });
  }
});

// ── POST /ai/competitors — Competitor analysis ────────────────────────────────
router.post("/ai/competitors", async (req, res) => {
  const { competitors, ourUrl, ourScore } = req.body as {
    competitors?: Array<{ name: string; url?: string; rating?: number }>;
    ourUrl?: string;
    ourScore?: number;
    context?: Record<string, unknown>;
  };

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiMarket")) {
    res.status(403).json(moduleDisabledResponse("aiMarket"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "market_intel", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: "Analyse concurrentielle temporairement indisponible.",
      orgId,
    });
    await trackAIUsage({ feature: "market_intel", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ analysis: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /competitors failed");
    res.status(500).json({ error: "Erreur analyse concurrentielle" });
  }
});

// ── POST /ai/reports — AI report generation ───────────────────────────────────
router.post("/ai/reports", async (req, res) => {
  const { reportType, period, sites, metrics } = req.body as {
    reportType?: string;
    period?: string;
    sites?: string[];
    metrics?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiReporting")) {
    res.status(403).json(moduleDisabledResponse("aiReporting"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "report_gen", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: "Génération de rapport IA temporairement indisponible.",
      orgId,
    });
    await trackAIUsage({ feature: "report_gen", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ report: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /reports failed");
    res.status(500).json({ error: "Erreur génération rapport" });
  }
});

// ── POST /ai/summary — Executive summary ──────────────────────────────────────
router.post("/ai/summary", async (req, res) => {
  const { context } = req.body as { context?: Record<string, unknown> };
  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiStrategist")) {
    res.status(403).json(moduleDisabledResponse("aiStrategist"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "strategist", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
    const fallbackText = "Résumé exécutif temporairement indisponible. Veuillez réessayer dans quelques instants.";
    const aiResult = await callAIWithFallback({
      task: "strategist",
      systemPrompt: "Tu es un directeur stratégique digital. Résumé concis, chiffré, actionnable. Français.",
      userPrompt: prompt,
      maxTokens: 1600,
      fallbackText,
      orgId,
    });
    if (!aiResult.text.trim()) {
      res.json({ summary: fallbackText, fallback: true });
      return;
    }
    await trackAIUsage({ feature: "strategist", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ summary: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /summary failed — returning fallback");
    res.json({ summary: "Résumé exécutif temporairement indisponible. Veuillez réessayer dans quelques instants.", fallback: true });
  }
});

// ── POST /ai/missions — AI mission generation ─────────────────────────────────
router.post("/ai/missions", async (req, res) => {
  const { profile, currentMissions, context } = req.body as {
    profile?: Record<string, unknown>;
    currentMissions?: unknown[];
    context?: Record<string, unknown>;
  };

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "dailyAI")) {
    res.status(403).json(moduleDisabledResponse("dailyAI"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "mission_auto", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: "{}",
      orgId,
    });
    let missions: unknown[];
    try {
      const parsed = JSON.parse(aiResult.text);
      missions = Array.isArray(parsed) ? parsed : (parsed.missions ?? buildFallbackMissions());
    } catch {
      missions = buildFallbackMissions();
    }
    await trackAIUsage({ feature: "mission_auto", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ missions, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /missions failed");
    res.json({ missions: buildFallbackMissions() });
  }
});

// ── POST /ai/pagespeed-insights — AI analysis of PSI data ────────────────────
router.post("/ai/pagespeed-insights", async (req, res) => {
  const { url, mobile, desktop } = req.body as {
    url?: string;
    mobile?: Record<string, unknown>;
    desktop?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId = req.orgId ?? "default";
  const aiPrefs = await loadOrgAIPrefs(orgId);
  if (!checkModuleEnabled(aiPrefs, "aiAlerts")) {
    res.status(403).json(moduleDisabledResponse("aiAlerts"));
    return;
  }
  const creditCheck = await consumeAICredits({ feature: "audit_summary", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

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
      fallbackText: buildFallbackPSIRecommendations(url, mobile),
      orgId,
    });
    await trackAIUsage({ feature: "audit_summary", orgId, model: aiResult.model, tokensIn: aiResult.tokensIn, tokensOut: aiResult.tokensOut, latencyMs: aiResult.latencyMs, success: true, provider: aiResult.provider });
    res.json({ recommendations: aiResult.text, model: aiResult.model, provider: aiResult.provider, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /pagespeed-insights failed");
    res.json({ recommendations: buildFallbackPSIRecommendations(url, mobile) });
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

// ── Fallback builders ─────────────────────────────────────────────────────────
function buildFallbackAudit(url: string, scores?: Record<string, number>): string {
  return `## Analyse SEO — ${url}

**Score actuel :** ${scores?.performance ?? "?"}/100

### Points critiques
- Optimisez les Core Web Vitals (LCP, CLS, INP)
- Améliorez la vitesse de chargement mobile
- Vérifiez la structure des balises meta

### Quick wins (< 2h)
- Compresser les images (gain estimé : +5-8 points)
- Activer la mise en cache navigateur
- Minifier JS/CSS non utilisé

*Connectez OpenAI pour une analyse approfondie.*`;
}

function buildFallbackSEO(url: string): string {
  return `## Recommandations SEO — ${url}

### Balises meta & structure
- 🔴 Optimisez la balise title (50-60 caractères avec mot-clé principal)
- 🟡 Meta description unique par page (120-158 caractères)

### Contenu & mots-clés
- 🔴 Identifiez 5 mots-clés longue traîne à fort potentiel local
- 🟡 Créez 2 articles de blog par mois ciblant ces mots-clés

*Connectez OpenAI pour des recommandations personnalisées.*`;
}

function buildFallbackMissions(): object[] {
  return [
    { title: "Optimiser les images du site", description: "Compresser et convertir en WebP toutes les images > 100KB.", category: "performance", priority: 9, estimatedImpact: "Élevé", estimatedEffort: "4h", expectedGain: "+10 points performance" },
    { title: "Corriger les balises title manquantes", description: "Ajouter des balises title uniques sur toutes les pages sans titre.", category: "seo", priority: 8, estimatedImpact: "Élevé", estimatedEffort: "2h", expectedGain: "+5-8 points SEO" },
    { title: "Améliorer le LCP mobile", description: "Identifier et optimiser l'élément LCP (image hero ou texte principal).", category: "performance", priority: 7, estimatedImpact: "Élevé", estimatedEffort: "1j", expectedGain: "LCP < 2.5s" },
    { title: "Créer une page Google Business Profile", description: "Optimiser la fiche GBP avec photos, horaires et réponses avis.", category: "local", priority: 8, estimatedImpact: "Critique", estimatedEffort: "4h", expectedGain: "+30% visibilité locale" },
    { title: "Supprimer le CSS non utilisé", description: "Analyser et supprimer les règles CSS inutilisées pour réduire le TBT.", category: "technical", priority: 6, estimatedImpact: "Moyen", estimatedEffort: "4h", expectedGain: "-200ms TBT" },
    { title: "Ajouter des données structurées", description: "Implémenter Schema.org (LocalBusiness, FAQPage) pour les rich snippets.", category: "seo", priority: 7, estimatedImpact: "Élevé", estimatedEffort: "1j", expectedGain: "+15% CTR" },
  ];
}

function buildFallbackPSIRecommendations(url: string, mobile?: Record<string, unknown>): string {
  const perf = (mobile?.scores as Record<string, number>)?.performance ?? 0;
  return `## Recommandations Performance — ${url}

**Score performance mobile :** ${perf}/100

### Optimisations prioritaires
1. **Réduire le LCP** — Préchargez l'image hero avec \`<link rel="preload">\`
2. **Éliminer les ressources bloquantes** — Déférez le JS non critique avec \`defer\`
3. **Optimiser les images** — Utilisez le format WebP et les dimensions adaptées

*Connectez OpenAI pour des recommandations détaillées avec exemples de code.*`;
}

router.get("/ai/recommendations", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    const rows = await client.query(
      `SELECT id, type, title, description, priority, status, created_at
       FROM ai_usage_logs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [orgId]
    );
    res.json({ recommendations: rows.rows });
  } catch {
    res.json({ recommendations: [] });
  } finally {
    client.release();
  }
});

router.post("/ai/generate", async (req: Request, res: Response) => {
  const { prompt, type = "general" } = req.body as { prompt?: string; type?: string };
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  try {
    const { openai, hasOpenAI } = await import("../lib/openai.js");
    if (!hasOpenAI) {
      return res.json({
        content: `[Contenu généré] ${prompt.slice(0, 100)}…\n\n*Connectez OpenAI pour une génération IA réelle.*`,
        mock: true,
      });
    }
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: `Tu es un assistant marketing expert. Type de contenu: ${type}.` },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 800,
    });
    res.json({ content: resp.choices[0]?.message?.content ?? "", mock: false });
  } catch {
    res.json({
      content: `[Contenu généré] ${prompt.slice(0, 100)}…\n\n*Erreur OpenAI — réessayez.*`,
      mock: true,
    });
  }
});

export default router;
