/**
 * competitor-analysis-service.ts
 *
 * Pipeline : URL publique → scraping pages clés → DataForSEO (optionnel) → IA → DB.
 * DataForSEO n'est jamais un point de panne global : si les métriques SEO sont
 * indisponibles l'analyse IA du site reste affichée.
 * L'IA ne doit jamais inventer de données — "Non déterminé" si inconnu.
 */

import { logger } from "../lib/logger.js";
import { randomUUID } from "node:crypto";
import { aiChat } from "./ai-provider.js";
import { checkAIQuota, recordCompletedUsageDeferred } from "./ai-engine.js";

const FETCH_TIMEOUT_MS  = 15_000;

// ── Strict system prompt ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un analyste business expert en veille concurrentielle. Tu analyses le contenu public de sites web concurrents pour une plateforme SaaS.

RÈGLES ABSOLUES :
1. Tu ne dois JAMAIS inventer, estimer ou extrapoler une information qui n'est pas explicitement présente dans le contenu fourni.
2. Si une donnée (prix, fonctionnalité, offre, etc.) est introuvable : réponds exactement "Non déterminé" pour les champs texte, [] pour les tableaux.
3. Niveau de confiance : "high" = information explicite sur la page, "medium" = déduite du contexte direct, "low" = très indirecte.
4. Réponds UNIQUEMENT en JSON valide. Aucun texte avant ou après.
5. Les opportunités doivent être actionnables et spécifiques, pas génériques.`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompetitorSource {
  url:         string;
  type:        "pricing" | "features" | "homepage" | "about" | "other";
  confidence:  "high" | "medium" | "low";
  detected_at: string;
  excerpt?:    string;
}

export interface Opportunity {
  title:        string;
  description:  string;
  missionTitle: string;
  missionDesc:  string;
}

export interface FeatureMatrixRow {
  feature:    string;
  you:        string;   // "✓" | "—" | description
  competitor: string;
}

export interface FullCompetitorAnalysis {
  id:              string;
  competitor_id:   string;
  url_fetched:     string;
  // Positionnement
  value_prop:      string;
  target_audience: string;
  products:        string;
  arguments:       string[];
  differentiators: string[];
  // Offre
  features:        string[];
  plans:           string[];
  pricing:         string;
  trial:           string;
  ctas:            string[];
  // SWOT
  strengths:       string[];
  weaknesses:      string[];
  advantages:      string[];
  disadvantages:   string[];
  differentiating: string[];
  // Comparaison
  you_better:      string[];
  they_better:     string[];
  opportunities:   Opportunity[];
  feature_matrix:  FeatureMatrixRow[];
  // Méta
  sources:           CompetitorSource[];
  snapshot_hash:     string;
  changes_detected:  Array<{ field: string; change: string }>;
  pages_fetched:     number;
  ai_available:      boolean;
  created_at:        string;
  updated_at:        string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseJsonArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
    catch { return []; }
  }
  return [];
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ── Web scraping ──────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ url: string; content: string; ok: boolean }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FlowPoint-Analyzer/1.0)",
        "Accept": "text/html,*/*;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return { url, content: "", ok: false };
    const html = await res.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 7000);
    return { url, content: text, ok: text.length > 80 };
  } catch {
    return { url, content: "", ok: false };
  }
}

async function scrapeCompetitor(baseUrl: string): Promise<{ pages: Array<{ url: string; content: string }>; anyOk: boolean }> {
  const base = baseUrl.replace(/\/$/, "");
  const urls = [base, `${base}/pricing`, `${base}/features`, `${base}/about`];
  const settled = await Promise.allSettled(urls.map(u => fetchPage(u)));
  const pages = settled
    .map((r, i) => r.status === "fulfilled" ? r.value : { url: urls[i]!, content: "", ok: false })
    .filter(p => p.ok);
  return { pages, anyOk: pages.length > 0 };
}

// ── AI call — canonical FlowPoint engine ─────────────────────────────────────
// Uses aiChat (provider selection + fallback) + recordCompletedUsageDeferred
// (quota debit + usage logs). Never calls OpenAI directly.

async function callAI(
  prompt: string,
  orgId: string,
  userId: string,
): Promise<{ content: string | null; quotaAllowed: boolean }> {
  // 1. Pre-check quota (read-only, non-blocking)
  const quota = await checkAIQuota({ feature: "market_intel", orgId }).catch(() => null);
  if (quota && !quota.allowed) {
    logger.warn({ orgId }, "[competitor-analysis] AI quota exhausted — skipping AI analysis");
    return { content: null, quotaAllowed: false };
  }

  const t0 = Date.now();
  try {
    // 2. Call via canonical provider (openai → anthropic → gemini fallback for internal routes)
    // json:true enables response_format:json_object on OpenAI; other providers use the system
    // prompt constraint ("reply only with valid JSON"). Gemini does not support json_object
    // response_format at all so the flag is ignored there — the SYSTEM_PROMPT is sufficient.
    const result = await aiChat({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:   prompt,
      task: "market_intel",
      json: true,
    });

    const latencyMs = Date.now() - t0;

    // 3. Deferred usage accounting (non-blocking — never blocks the response)
    recordCompletedUsageDeferred({
      feature:   "market_intel",
      orgId,
      userId,
      model:     result._ai.model as import("./ai-engine.js").AIModel,
      provider:  result._ai.provider,
      tokensIn:  result.usage.promptTokens    ?? 0,
      tokensOut: result.usage.completionTokens ?? 0,
      latencyMs,
      success:   true,
    });

    // Strip markdown code-block wrappers that Anthropic may add
    // (e.g. ```json\n{...}\n```) — OpenAI's json:true prevents this but
    // Anthropic ignores the flag and may wrap the response.
    let raw = result.text ?? null;
    if (raw) {
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) raw = match[1]!.trim();
    }
    return { content: raw, quotaAllowed: true };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logger.warn({ err, orgId }, "[competitor-analysis] AI call failed");
    recordCompletedUsageDeferred({
      feature:   "market_intel",
      orgId,
      userId,
      model:     "gpt-5-mini",
      provider:  "openai",
      tokensIn:  0,
      tokensOut: 0,
      latencyMs,
      success:   false,
    });
    return { content: null, quotaAllowed: true };
  }
}

// ── Change detection ──────────────────────────────────────────────────────────

function detectChanges(
  prev: Partial<FullCompetitorAnalysis> | null,
  next: Pick<FullCompetitorAnalysis, "pricing" | "trial" | "value_prop" | "features" | "plans">,
): Array<{ field: string; change: string }> {
  if (!prev) return [];
  const ch: Array<{ field: string; change: string }> = [];
  if (prev.pricing && prev.pricing !== next.pricing && next.pricing !== "Non déterminé") {
    ch.push({ field: "pricing", change: `Prix : "${prev.pricing}" → "${next.pricing}"` });
  }
  if (prev.trial && prev.trial !== next.trial && next.trial !== "Non déterminé") {
    ch.push({ field: "trial", change: `Essai gratuit : "${prev.trial}" → "${next.trial}"` });
  }
  if (prev.value_prop && prev.value_prop !== next.value_prop) {
    ch.push({ field: "value_prop", change: "Proposition de valeur modifiée" });
  }
  const pf = new Set(prev.features ?? []);
  const added   = (next.features ?? []).filter(f => !pf.has(f));
  const removed = (prev.features ?? []).filter(f => !new Set(next.features ?? []).has(f));
  if (added.length)   ch.push({ field: "features_added",   change: `Fonctionnalité(s) ajoutée(s) : ${added.slice(0,3).join(", ")}` });
  if (removed.length) ch.push({ field: "features_removed", change: `Fonctionnalité(s) supprimée(s) : ${removed.slice(0,3).join(", ")}` });
  const pp = new Set(prev.plans ?? []);
  const addedPl = (next.plans ?? []).filter(p => !pp.has(p));
  if (addedPl.length) ch.push({ field: "plans_added", change: `Nouvelle(s) offre(s) : ${addedPl.join(", ")}` });
  return ch;
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function rowToAnalysis(row: Record<string, unknown>): FullCompetitorAnalysis {
  return {
    id:              String(row["id"] ?? ""),
    competitor_id:   String(row["competitor_id"] ?? ""),
    url_fetched:     String(row["url_fetched"] ?? ""),
    value_prop:      String(row["value_prop"] ?? "Non déterminé"),
    target_audience: String(row["target_audience"] ?? "Non déterminé"),
    products:        String(row["products"] ?? "Non déterminé"),
    arguments:       parseJsonArray(row["arguments"]) as string[],
    differentiators: parseJsonArray(row["differentiators"]) as string[],
    features:        parseJsonArray(row["features"]) as string[],
    plans:           parseJsonArray(row["plans"]) as string[],
    pricing:         String(row["pricing"] ?? "Non déterminé"),
    trial:           String(row["trial"] ?? "Non déterminé"),
    ctas:            parseJsonArray(row["ctas"]) as string[],
    strengths:       parseJsonArray(row["strengths"]) as string[],
    weaknesses:      parseJsonArray(row["weaknesses"]) as string[],
    advantages:      parseJsonArray(row["advantages"]) as string[],
    disadvantages:   parseJsonArray(row["disadvantages"]) as string[],
    differentiating: parseJsonArray(row["differentiating"]) as string[],
    you_better:      parseJsonArray(row["you_better"]) as string[],
    they_better:     parseJsonArray(row["they_better"]) as string[],
    opportunities:   parseJsonArray(row["opportunities"]) as Opportunity[],
    feature_matrix:  parseJsonArray(row["feature_matrix"]) as FeatureMatrixRow[],
    sources:         parseJsonArray(row["sources"]) as CompetitorSource[],
    snapshot_hash:   String(row["snapshot_hash"] ?? ""),
    changes_detected: parseJsonArray(row["changes_detected"]) as Array<{ field: string; change: string }>,
    pages_fetched:   Number(row["pages_fetched"] ?? 0),
    ai_available:    Boolean(row["ai_available"]),
    created_at:      String(row["created_at"] ?? ""),
    updated_at:      String(row["updated_at"] ?? ""),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

type OrgDb = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null | undefined }>;

export async function getCompetitorAnalysis(
  competitorId: string,
  orgId: string,
  orgDb: OrgDb,
): Promise<FullCompetitorAnalysis | null> {
  try {
    const r = await orgDb(
      `SELECT * FROM competitor_analysis WHERE competitor_id=$1 AND org_id=$2 LIMIT 1`,
      [competitorId, orgId],
    );
    return r.rows[0] ? rowToAnalysis(r.rows[0]) : null;
  } catch {
    return null;
  }
}

export async function runFullCompetitorAnalysis(opts: {
  competitorId:   string;
  competitorName: string;
  competitorUrl:  string;
  orgId:          string;
  userId?:        string;
  orgDb:          OrgDb;
  /** Org context for comparison — fetched from DB by caller */
  orgContext?: {
    orgName?:     string;
    orgUrl?:      string;
    orgPlan?:     string;
    orgKeywords?: string[];
    orgScore?:    number;
    orgFeatures?: string[];
  };
}): Promise<{ ok: boolean; analysis?: FullCompetitorAnalysis; error?: string }> {
  const { competitorId, competitorName, competitorUrl, orgId, userId = "system", orgDb, orgContext = {} } = opts;

  try {
    // 1. Scrape competitor site
    const { pages, anyOk } = await scrapeCompetitor(competitorUrl);
    if (!anyOk) {
      return { ok: false, error: "Impossible de récupérer le contenu du site concurrent (site inaccessible ou protection anti-bot)" };
    }

    const combinedContent = pages
      .map(p => `=== Page : ${p.url} ===\n${p.content}`)
      .join("\n\n");

    const contentHash = hashStr(combinedContent);

    // 2. Load previous analysis for diff detection
    let previous: FullCompetitorAnalysis | null = null;
    try {
      const pr = await orgDb(
        `SELECT pricing, trial, value_prop, features, plans FROM competitor_analysis WHERE competitor_id=$1 AND org_id=$2 LIMIT 1`,
        [competitorId, orgId],
      );
      if (pr.rows[0]) {
        const row = pr.rows[0];
        previous = {
          pricing:    String(row["pricing"] ?? ""),
          trial:      String(row["trial"] ?? ""),
          value_prop: String(row["value_prop"] ?? ""),
          features:   parseJsonArray(row["features"]) as string[],
          plans:      parseJsonArray(row["plans"]) as string[],
        } as FullCompetitorAnalysis;
      }
    } catch { /* non-fatal */ }

    // 3. Build org context string for comparison
    const orgCtxStr = [
      orgContext.orgName   ? `Nom de l'entreprise : ${orgContext.orgName}` : "",
      orgContext.orgUrl    ? `Site web : ${orgContext.orgUrl}` : "",
      orgContext.orgPlan   ? `Plan actuel : ${orgContext.orgPlan}` : "",
      orgContext.orgScore  ? `Score SEO actuel : ${orgContext.orgScore}/100` : "",
      (orgContext.orgKeywords?.length ?? 0) > 0
        ? `Mots-clés suivis : ${orgContext.orgKeywords!.slice(0, 10).join(", ")}`
        : "",
      (orgContext.orgFeatures?.length ?? 0) > 0
        ? `Fonctionnalités/avantages connus : ${orgContext.orgFeatures!.join(", ")}`
        : "",
    ].filter(Boolean).join("\n");

    // 4. Single AI call — analysis + comparison + feature matrix in one prompt
    const prompt = `Analyse ce concurrent et génère une comparaison avec l'entreprise de l'utilisateur.

CONCURRENT À ANALYSER : ${competitorName} (${competitorUrl})
PAGES RÉCUPÉRÉES (${pages.length}) :
${combinedContent.slice(0, 14000)}

CONTEXTE DE L'ENTREPRISE UTILISATEUR :
${orgCtxStr || "Aucun contexte disponible."}

Génère exactement ce JSON (toutes les clés sont obligatoires) :
{
  "value_prop": "proposition de valeur (ou Non déterminé)",
  "target_audience": "cible client (ou Non déterminé)",
  "products": "produits et services principaux (ou Non déterminé)",
  "arguments": ["argument commercial 1", ...],
  "differentiators": ["différenciateur clé 1", ...],
  "features": ["fonctionnalité 1", "fonctionnalité 2", ...],
  "plans": ["nom du plan 1", ...],
  "pricing": "tarifs détectés (ou Non déterminé)",
  "trial": "essai gratuit / démo détecté (ou Non déterminé)",
  "ctas": ["CTA principal 1", ...],
  "strengths": ["force 1", ...],
  "weaknesses": ["faiblesse détectable 1", ...],
  "advantages": ["avantage concurrentiel 1", ...],
  "disadvantages": ["inconvénient 1", ...],
  "differentiating": ["élément différenciant 1", ...],
  "you_better": ["Ce que l'utilisateur fait mieux que ce concurrent — point 1", ...],
  "they_better": ["Ce que ce concurrent fait mieux — point 1", ...],
  "opportunities": [
    {
      "title": "Titre court de l'opportunité",
      "description": "Explication détaillée de l'opportunité, basée sur l'analyse",
      "missionTitle": "Titre de la mission à créer",
      "missionDesc": "Description détaillée de la mission FlowPoint"
    }
  ],
  "feature_matrix": [
    {"feature": "Nom de la fonctionnalité", "you": "✓ ou description ou —", "competitor": "✓ ou description ou —"}
  ],
  "sources": [
    {"url": "url_source", "type": "pricing|features|homepage|about|other", "confidence": "high|medium|low", "detected_at": "${new Date().toISOString().slice(0, 10)}", "excerpt": "extrait justificatif bref"}
  ]
}

Règles critiques :
- N'invente aucune information. Si inconnue : "Non déterminé" ou [].
- you_better et they_better doivent être basés sur les données réelles du contexte.
- Si aucun contexte utilisateur : you_better = [] et they_better = basé sur le concurrent seul.
- opportunities : max 5, actionnables, basées sur les vrais écarts détectés.
- feature_matrix : liste les fonctionnalités clés détectées, avec "—" si non disponible côté utilisateur ou concurrent.`;

    const { content: rawJson, quotaAllowed } = await callAI(prompt, orgId, userId);
    const aiAvailable = rawJson !== null;
    if (!quotaAllowed) {
      logger.warn({ orgId, competitorId }, "[competitor-analysis] Crédits IA insuffisants — analyse sans IA");
    }

    // Parse AI output — fallback to empty on parse error
    let aiData: Record<string, unknown> = {};
    if (rawJson) {
      try { aiData = JSON.parse(rawJson) as Record<string, unknown>; }
      catch (err) {
        logger.warn({ err, rawJson: rawJson.slice(0, 300) }, "[competitor-analysis] JSON parse failed");
      }
    }

    const getString = (k: string) => typeof aiData[k] === "string" ? (aiData[k] as string) : "Non déterminé";
    const getArr = (k: string) => parseJsonArray(aiData[k]);

    const analysis = {
      value_prop:      getString("value_prop"),
      target_audience: getString("target_audience"),
      products:        getString("products"),
      arguments:       getArr("arguments") as string[],
      differentiators: getArr("differentiators") as string[],
      features:        getArr("features") as string[],
      plans:           getArr("plans") as string[],
      pricing:         getString("pricing"),
      trial:           getString("trial"),
      ctas:            getArr("ctas") as string[],
      strengths:       getArr("strengths") as string[],
      weaknesses:      getArr("weaknesses") as string[],
      advantages:      getArr("advantages") as string[],
      disadvantages:   getArr("disadvantages") as string[],
      differentiating: getArr("differentiating") as string[],
      you_better:      getArr("you_better") as string[],
      they_better:     getArr("they_better") as string[],
      opportunities:   getArr("opportunities") as Opportunity[],
      feature_matrix:  getArr("feature_matrix") as FeatureMatrixRow[],
      sources:         aiAvailable
        ? getArr("sources") as CompetitorSource[]
        : pages.map(p => ({ url: p.url, type: "homepage" as const, confidence: "low" as const, detected_at: new Date().toISOString().slice(0, 10) })),
    };

    // 5. Change detection
    const changesDetected = detectChanges(previous, analysis);

    // 6. Persist — upsert by (competitor_id, org_id)
    const id = `ca_${randomUUID()}`;

    await orgDb(
      `INSERT INTO competitor_analysis (
        id, org_id, competitor_id, url_fetched,
        value_prop, target_audience, products, arguments, differentiators,
        features, plans, pricing, trial, ctas,
        strengths, weaknesses, advantages, disadvantages, differentiating,
        you_better, they_better, opportunities, feature_matrix,
        sources, snapshot_hash, changes_detected, pages_fetched, ai_available,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4, $5,$6,$7,$8,$9, $10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19, $20,$21,$22,$23, $24,$25,$26,$27,$28, NOW(),NOW()
      )
      ON CONFLICT (competitor_id, org_id) DO UPDATE SET
        url_fetched=$4, value_prop=$5, target_audience=$6, products=$7,
        arguments=$8, differentiators=$9, features=$10, plans=$11, pricing=$12,
        trial=$13, ctas=$14, strengths=$15, weaknesses=$16, advantages=$17,
        disadvantages=$18, differentiating=$19, you_better=$20, they_better=$21,
        opportunities=$22, feature_matrix=$23, sources=$24, snapshot_hash=$25,
        changes_detected=$26, pages_fetched=$27, ai_available=$28, updated_at=NOW()`,
      [
        id, orgId, competitorId, competitorUrl,
        analysis.value_prop, analysis.target_audience, analysis.products,
        JSON.stringify(analysis.arguments), JSON.stringify(analysis.differentiators),
        JSON.stringify(analysis.features), JSON.stringify(analysis.plans),
        analysis.pricing, analysis.trial, JSON.stringify(analysis.ctas),
        JSON.stringify(analysis.strengths), JSON.stringify(analysis.weaknesses),
        JSON.stringify(analysis.advantages), JSON.stringify(analysis.disadvantages),
        JSON.stringify(analysis.differentiating),
        JSON.stringify(analysis.you_better), JSON.stringify(analysis.they_better),
        JSON.stringify(analysis.opportunities), JSON.stringify(analysis.feature_matrix),
        JSON.stringify(analysis.sources), contentHash,
        JSON.stringify(changesDetected), pages.length, aiAvailable,
      ],
    );

    // 7. Read back the saved row
    const saved = await orgDb(
      `SELECT * FROM competitor_analysis WHERE competitor_id=$1 AND org_id=$2 LIMIT 1`,
      [competitorId, orgId],
    );

    const result = saved.rows[0]
      ? rowToAnalysis(saved.rows[0])
      : { ...analysis, id, competitor_id: competitorId, url_fetched: competitorUrl,
          snapshot_hash: contentHash, changes_detected: changesDetected,
          pages_fetched: pages.length, ai_available: aiAvailable,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

    return { ok: true, analysis: result as FullCompetitorAnalysis };
  } catch (err) {
    logger.error({ err, competitorId, orgId }, "[competitor-analysis] runFullCompetitorAnalysis failed");
    return { ok: false, error: "Erreur lors de l'analyse — réessayez dans quelques instants" };
  }
}
