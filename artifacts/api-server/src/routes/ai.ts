import { Router, type Request, type Response } from "express";
import { pool, db, auditsTable, monitorsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { aiRateLimit } from "../middlewares/rateLimiter.js";
import {
  consumeAICredits,
  selectOptimalModel,
  trackAIUsage,
  getAIUsageStats,
  getOrCreateMonthlyUsage,
  recordCompletedUsage,
  type AIFeature,
} from "../services/ai-engine.js";

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

// ── OpenAI client factory ─────────────────────────────────────────────────────
async function getOpenAI() {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey });
}

// ── Shared context builder ────────────────────────────────────────────────────
async function buildFlowpointContext(extra?: Record<string, unknown>): Promise<string> {
  try {
    const [audits, monitors] = await Promise.all([
      db.select().from(auditsTable).orderBy(desc(auditsTable.createdAt)).limit(5),
      db.select().from(monitorsTable).limit(5),
    ]);
    const avgScore = audits.length > 0
      ? Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)
      : 0;
    const downCount = monitors.filter(m => m.status === "down").length;

    return [
      `Platform: Flowpoint SaaS SEO Dashboard`,
      `Plan: ${store.me.plan ?? "Pro"}`,
      `Avg SEO score: ${avgScore}/100 across ${audits.length} audited sites`,
      `Monitors: ${monitors.length} total, ${downCount} DOWN`,
      `Top sites: ${audits.slice(0, 3).map(a => `${a.url} (${a.score}/100)`).join(", ")}`,
      extra ? `Additional context: ${JSON.stringify(extra)}` : "",
    ].filter(Boolean).join("\n");
  } catch {
    return `Platform: Flowpoint SaaS SEO Dashboard. Plan: ${store.me.plan ?? "Pro"}.`;
  }
}

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
      `, [id, opts.orgId, opts.userId, opts.role, opts.content, opts.feature, opts.model ?? "gpt-4o-mini", opts.tokensUsed ?? 0]);
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

  const { message, context, stream: wantStream = true, history = [] } = req.body as {
    message?: string;
    context?: Record<string, unknown>;
    stream?: boolean;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message requis" });
    return;
  }

  const orgId  = req.orgId  ?? "default";
  const userId = req.userId ?? "anonymous";

  // 1. Check OpenAI is configured BEFORE any DB write — never consume quota for a call that can't happen
  const openai = await getOpenAI();
  if (!openai) {
    res.status(503).json({ error: "AI not configured" });
    return;
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

  const fpContext = await buildFlowpointContext(context);
  const systemPrompt = `Tu es l'assistant IA de Flowpoint, expert SEO local français et analyste web senior.
Tu analyses les données SEO, performances web, comportement utilisateur et CRO.
Réponds en français, avec des réponses précises et actionnables. Utilise ** pour le gras et - pour les listes.
Contexte de la plateforme:\n${fpContext}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // Persist user message fire-and-forget — log failures but never block streaming
  persistChatMessage({ orgId, userId, role: "user", content: message, feature: "chat" })
    .catch(err => logger.warn({ err }, "[AI] persistChatMessage (user) failed"));

  if (wantStream) {
    // SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const t0 = Date.now();
    let fullReply = "";
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const streamResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        stream: true,
        // Request real token counts in the final chunk's usage field
        stream_options: { include_usage: true },
        max_tokens: 800,
        temperature: 0.7,
      });

      for await (const chunk of streamResp) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          fullReply += delta;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        // The final chunk carries real usage when include_usage: true
        if (chunk.usage) {
          tokensIn  = chunk.usage.prompt_tokens;
          tokensOut = chunk.usage.completion_tokens;
        }
      }
      res.write(`data: [DONE]\n\n`);
      res.end();

      const latencyMs = Date.now() - t0;
      // 3. Atomic increment with REAL token counts AFTER completion — fire-and-forget, never blocks response
      persistChatMessage({ orgId, userId, role: "assistant", content: fullReply, feature: "chat", model: "gpt-4o-mini", tokensUsed: tokensOut })
        .catch(err => logger.warn({ err }, "[AI] persistChatMessage (assistant) failed"));
      recordCompletedUsage({ feature: "chat", orgId, userId, model: "gpt-4o-mini", tokensIn, tokensOut, latencyMs, success: true })
        .catch(err => logger.warn({ err }, "[AI] recordCompletedUsage failed"));
    } catch (err) {
      logger.error({ err }, "[AI] Streaming chat failed");
      res.write(`data: ${JSON.stringify({ error: "Erreur de génération IA" })}\n\n`);
      res.end();
    }
  } else {
    // Non-streaming fallback
    try {
      const t0 = Date.now();
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 800,
        temperature: 0.7,
      });
      const reply = resp.choices[0]?.message?.content ?? "Je ne peux pas répondre pour le moment.";
      const latencyMs = Date.now() - t0;
      const tokensIn = resp.usage?.prompt_tokens ?? 0;
      const tokensOut = resp.usage?.completion_tokens ?? 0;

      persistChatMessage({ orgId, userId, role: "assistant", content: reply, feature: "chat", model: "gpt-4o-mini", tokensUsed: tokensOut })
        .catch(err => logger.warn({ err }, "[AI] persistChatMessage (assistant non-stream) failed"));
      recordCompletedUsage({ feature: "chat", orgId, userId, model: "gpt-4o-mini", tokensIn, tokensOut, latencyMs, success: true })
        .catch(err => logger.warn({ err }, "[AI] recordCompletedUsage (non-stream) failed"));
      res.json({ reply, streaming: false });
    } catch (err) {
      logger.error({ err }, "[AI] Chat failed");
      res.status(500).json({ error: "Erreur IA — réessayez" });
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
  const creditCheck = await consumeAICredits({ feature: "audit_summary", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  if (!openai) {
    res.json({ analysis: buildFallbackAudit(url, scores) });
    return;
  }

  const prompt = `Analyse SEO et technique complète pour ${url}.
Scores: ${JSON.stringify(scores ?? {})}
Core Web Vitals: ${JSON.stringify(cwv ?? {})}
Problèmes détectés: ${(issues ?? []).join(", ") || "Aucun fourni"}

Fournis une analyse structurée en français avec:
1. **Résumé exécutif** (2-3 phrases)
2. **Points critiques** (max 5 problèmes prioritaires)
3. **Quick wins** (3 actions < 2h avec impact estimé)
4. **Plan 30 jours** (roadmap structurée)
5. **Estimation de gain** (amélioration de score attendue)`;

  try {
    const t0 = Date.now();
    const model = selectOptimalModel("audit_summary", "balanced");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un expert SEO technique senior. Réponds en markdown structuré." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1200,
      temperature: 0.5,
    });
    const analysis = resp.choices[0]?.message?.content ?? "";
    const latencyMs = Date.now() - t0;
    await trackAIUsage({ feature: "audit_summary", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs, success: true });
    res.json({ analysis, model, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /audit failed");
    res.json({ analysis: buildFallbackAudit(url, scores) });
  }
});

// ── POST /ai/seo — SEO recommendations ───────────────────────────────────────
router.post("/ai/seo", async (req, res) => {
  const { url, keywords, currentScore } = req.body as {
    url?: string;
    keywords?: string[];
    currentScore?: number;
    context?: Record<string, unknown>;
  };

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const orgId = req.orgId ?? "default";
  const creditCheck = await consumeAICredits({ feature: "cro_analysis", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  if (!openai) {
    res.json({ recommendations: buildFallbackSEO(url) });
    return;
  }

  const prompt = `Recommandations SEO pour ${url} (score actuel: ${currentScore ?? "inconnu"}/100).
Mots-clés cibles: ${(keywords ?? []).join(", ") || "non fournis"}

Génère des recommandations SEO actionnables en 5 sections:
1. **Balises meta & structure HTML**
2. **Contenu & mots-clés**  
3. **Netlinking & autorité**
4. **SEO technique** (vitesse, mobile, indexation)
5. **Contenu local** (si applicable)
Chaque section : 3-4 recommandations avec priorité (🔴 critique / 🟡 important / 🟢 bonus).`;

  try {
    const t0 = Date.now();
    const model = selectOptimalModel("cro_analysis", "balanced");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un consultant SEO expert. Réponses en markdown, français." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.6,
    });
    const recommendations = resp.choices[0]?.message?.content ?? "";
    const latencyMs = Date.now() - t0;
    await trackAIUsage({ feature: "cro_analysis", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs, success: true });
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
  const creditCheck = await consumeAICredits({ feature: "cro_analysis", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  if (!openai) {
    res.json({ analysis: "Analyse CRO non disponible sans clé OpenAI." });
    return;
  }

  const fpCtx = await buildFlowpointContext();
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
    const t0 = Date.now();
    const model = selectOptimalModel("cro_analysis");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un expert CRO et UX. Réponds en français avec des recommandations concrètes." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
    });
    const analysis = resp.choices[0]?.message?.content ?? "";
    await trackAIUsage({ feature: "cro_analysis", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ analysis, creditsRemaining: creditCheck.remaining });
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
  const creditCheck = await consumeAICredits({ feature: "market_intel", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  if (!openai) {
    res.json({ recommendations: "Recommandations Local SEO non disponibles sans clé OpenAI." });
    return;
  }

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
    const t0 = Date.now();
    const model = selectOptimalModel("market_intel");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un expert Local SEO et Google Business Profile. Réponds en français." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1200,
    });
    const recommendations = resp.choices[0]?.message?.content ?? "";
    await trackAIUsage({ feature: "market_intel", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ recommendations, creditsRemaining: creditCheck.remaining });
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
  const creditCheck = await consumeAICredits({ feature: "market_intel", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  if (!openai) {
    res.json({ analysis: "Analyse concurrentielle non disponible sans clé OpenAI." });
    return;
  }

  const prompt = `Analyse concurrentielle pour ${ourUrl ?? "notre site"} (score SEO: ${ourScore ?? "?"}/100).
Concurrents: ${JSON.stringify(competitors ?? [])}

Fournis:
1. **Analyse des gaps** (ce qu'ils font mieux que nous)
2. **Avantages concurrentiels** à exploiter
3. **Opportunités de mots-clés** qu'ils ne couvrent pas
4. **Stratégie de contenu** pour les dépasser
5. **Estimation de temps** pour rattraper le leader`;

  try {
    const t0 = Date.now();
    const model = selectOptimalModel("market_intel");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un analyste stratégique SEO. Réponds en français avec des insights actionnables." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1200,
    });
    const analysis = resp.choices[0]?.message?.content ?? "";
    await trackAIUsage({ feature: "market_intel", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ analysis, creditsRemaining: creditCheck.remaining });
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
  const creditCheck = await consumeAICredits({ feature: "report_gen", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  const fpCtx = await buildFlowpointContext();

  if (!openai) {
    res.json({ report: "Génération de rapport IA non disponible sans clé OpenAI." });
    return;
  }

  const prompt = `Génère un rapport ${reportType ?? "SEO mensuel"} pour la période ${period ?? "Mai 2026"}.
Sites analysés: ${(sites ?? []).join(", ") || "selon le contexte"}
Métriques: ${JSON.stringify(metrics ?? {})}
Contexte plateforme: ${fpCtx}

Rapport structuré:
# Résumé Exécutif
(2-3 phrases sur les résultats clés)

# Points Forts Ce Mois
(3-5 victoires avec chiffres)

# Problèmes Identifiés  
(3-5 points avec priorité)

# Actions Recommandées
(Plan 30 jours avec responsable et délai)

# Prévisions Mois Prochain
(Objectifs SMART)`;

  try {
    const t0 = Date.now();
    const model = selectOptimalModel("report_gen", "max");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un consultant SEO senior générant des rapports clients professionnels. Français formel, structuré en markdown." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
    });
    const report = resp.choices[0]?.message?.content ?? "";
    await trackAIUsage({ feature: "report_gen", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ report, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /reports failed");
    res.status(500).json({ error: "Erreur génération rapport" });
  }
});

// ── POST /ai/summary — Executive summary ──────────────────────────────────────
router.post("/ai/summary", async (req, res) => {
  const { context } = req.body as { context?: Record<string, unknown> };
  const orgId = req.orgId ?? "default";
  const creditCheck = await consumeAICredits({ feature: "strategist", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  const fpCtx = await buildFlowpointContext(context);

  if (!openai) {
    res.json({ summary: "Résumé exécutif non disponible sans clé OpenAI." });
    return;
  }

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
    const t0 = Date.now();
    const model = selectOptimalModel("strategist", "max");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un directeur stratégique digital. Résumé concis, chiffré, actionnable. Français." },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
    });
    const summary = resp.choices[0]?.message?.content ?? "";
    await trackAIUsage({ feature: "strategist", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ summary, creditsRemaining: creditCheck.remaining });
  } catch (err) {
    logger.error({ err }, "[AI] /summary failed");
    res.status(500).json({ error: "Erreur résumé exécutif" });
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
  const creditCheck = await consumeAICredits({ feature: "mission_auto", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  const fpCtx = await buildFlowpointContext(context);

  if (!openai) {
    res.json({ missions: buildFallbackMissions() });
    return;
  }

  const prompt = `Génère 6 missions SEO prioritaires pour ce compte.
Contexte: ${fpCtx}
Profil: ${JSON.stringify(profile ?? {})}
Missions actuelles: ${JSON.stringify((currentMissions ?? []).slice(0, 3))}

Retourne un JSON array de 6 missions avec:
{
  "title": "string (court, actionnable)",
  "description": "string (2-3 phrases expliquant quoi faire)",
  "category": "seo|performance|content|local|conversion|technical",
  "priority": 1-10,
  "estimatedImpact": "Faible|Moyen|Élevé|Critique",
  "estimatedEffort": "1h|4h|1j|1sem|2sem",
  "expectedGain": "string (ex: +8 points SEO)"
}

Réponds uniquement avec le JSON array.`;

  try {
    const t0 = Date.now();
    const model = selectOptimalModel("mission_auto");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu génères des missions SEO JSON structurées. Réponds UNIQUEMENT avec du JSON valide, aucun autre texte." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    let missions: unknown[];
    try {
      const parsed = JSON.parse(raw);
      missions = Array.isArray(parsed) ? parsed : (parsed.missions ?? buildFallbackMissions());
    } catch {
      missions = buildFallbackMissions();
    }
    await trackAIUsage({ feature: "mission_auto", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ missions, creditsRemaining: creditCheck.remaining });
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
  const creditCheck = await consumeAICredits({ feature: "audit_summary", orgId });
  if (!creditCheck.allowed) { res.status(402).json({ error: "Crédits IA insuffisants" }); return; }

  const openai = await getOpenAI();
  if (!openai) {
    res.json({ recommendations: buildFallbackPSIRecommendations(url, mobile) });
    return;
  }

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
    const t0 = Date.now();
    const model = selectOptimalModel("audit_summary");
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Tu es un expert performance web (Core Web Vitals, PageSpeed). Réponds en français avec des actions concrètes et du code si nécessaire." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1200,
    });
    const recommendations = resp.choices[0]?.message?.content ?? "";
    await trackAIUsage({ feature: "audit_summary", orgId, model, tokensIn: resp.usage?.prompt_tokens ?? 0, tokensOut: resp.usage?.completion_tokens ?? 0, latencyMs: Date.now() - t0, success: true });
    res.json({ recommendations, creditsRemaining: creditCheck.remaining });
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
      resetDate,
      byFeature:    stats.byFeature,
      dailyHistory: stats.dailyHistory,
      alerts:       stats.alerts,
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

export default router;
