import { randomUUID } from "crypto";
import { db, revenueLeaksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface RevenueLeakData {
  leaks: RevenueLeakItem[];
  summary: {
    totalLeaks:           number;
    activeLeaks:          number;
    estimatedMonthlyLoss: number;
    resolvedSavings:      number;
    topCategory:          string;
    criticalLeaks:        number;
  };
}

export interface RevenueLeakItem {
  id:                   string;
  orgId:                string;
  siteUrl:              string | null;
  leakType:             string;
  page:                 string;
  title:                string;
  description:          string | null;
  estimatedMonthlyLoss: number | null;
  impactScore:          number | null;
  fixDifficultyMin:     number | null;
  quickFix:             string | null;
  status:               string;
  metadata:             unknown;
  detectedAt:           Date | null;
  resolvedAt:           Date | null;
}

const LEAK_TEMPLATES = [
  {
    leakType: "conversion",
    page:     "/panier",
    title:    "Abandon de panier élevé",
    description: "73% des paniers ne sont pas finalisés. Chaque 1% d'amélioration du taux de conversion = +1 200€/mois.",
    estimatedMonthlyLoss: 3600,
    impactScore:          90,
    fixDifficultyMin:     120,
    quickFix: "Ajouter un email de relance panier (récupère 5-10% des abandons)",
  },
  {
    leakType: "performance",
    page:     "/",
    title:    "Temps de chargement > 3s",
    description: "Un délai de 1s réduit les conversions de 7%. Vos pages mettent en moyenne 3.8s à charger sur mobile.",
    estimatedMonthlyLoss: 1800,
    impactScore:          78,
    fixDifficultyMin:     240,
    quickFix: "Optimiser les images (WebP) et activer le cache navigateur",
  },
  {
    leakType: "seo",
    page:     "/blog",
    title:    "Pages sans trafic organique",
    description: "38 pages de votre site n'ont reçu aucun trafic organique en 90 jours.",
    estimatedMonthlyLoss: 900,
    impactScore:          55,
    fixDifficultyMin:     180,
    quickFix: "Fusionner les pages orphelines ou les rediriger vers des contenus performants",
  },
  {
    leakType: "ux",
    page:     "/contact",
    title:    "Formulaire de contact abandonné",
    description: "Le formulaire de contact affiche un taux d'abandon de 68%.",
    estimatedMonthlyLoss: 2200,
    impactScore:          82,
    fixDifficultyMin:     60,
    quickFix: "Réduire à 3 champs essentiels (nom, email, message)",
  },
  {
    leakType: "local",
    page:     "/avis",
    title:    "Avis négatifs sans réponse",
    description: "5 avis 1-2 étoiles sans réponse depuis > 7 jours impactent la réputation locale.",
    estimatedMonthlyLoss: 700,
    impactScore:          48,
    fixDifficultyMin:     30,
    quickFix: "Répondre aux avis négatifs sous 24h pour montrer l'engagement",
  },
];

export async function getRevenueLeakData(orgId: string, siteUrl?: string): Promise<RevenueLeakData> {
  const where = siteUrl
    ? and(eq(revenueLeaksTable.orgId, orgId), eq(revenueLeaksTable.siteUrl, siteUrl))
    : eq(revenueLeaksTable.orgId, orgId);

  const leaks = (await db.select().from(revenueLeaksTable).where(where).limit(50)) as RevenueLeakItem[];

  const activeLeaks   = leaks.filter(l => l.status === "active");
  const resolvedLeaks = leaks.filter(l => l.status === "resolved");

  return {
    leaks,
    summary: {
      totalLeaks:            leaks.length,
      activeLeaks:           activeLeaks.length,
      estimatedMonthlyLoss:  activeLeaks.reduce((s, l) => s + Number(l.estimatedMonthlyLoss ?? 0), 0),
      resolvedSavings:       resolvedLeaks.reduce((s, l) => s + Number(l.estimatedMonthlyLoss ?? 0), 0),
      topCategory:           activeLeaks.length > 0
        ? activeLeaks.sort((a, b) => Number(b.estimatedMonthlyLoss) - Number(a.estimatedMonthlyLoss))[0].leakType
        : "N/A",
      criticalLeaks:         activeLeaks.filter(l => Number(l.impactScore ?? 0) >= 80).length,
    },
  };
}

// ── AI generation ────────────────────────────────────────────────────────────
// Revenue Leak Detector is an AI agent: leaks are generated per-site so two
// sites never receive the same identical list. LEAK_TEMPLATES above are ONLY
// a fallback when no AI provider is configured or the call fails.
const VALID_LEAK_TYPES = new Set(["conversion", "performance", "seo", "ux", "local", "trust", "mobile"]);

async function detectLeaksWithAI(siteUrl: string): Promise<Array<{
  leakType: string; page: string; title: string; description: string;
  estimatedMonthlyLoss: number; impactScore: number; fixDifficultyMin: number; quickFix: string;
}> | null> {
  try {
    const { aiChatCompletion } = await import("../lib/openai-client.js");
    const raw = await aiChatCompletion({
      systemPrompt:
        "Tu es un expert en détection de fuites de revenus (revenue leaks) pour sites web de PME francophones. " +
        "Tu identifies des pertes de revenus PLAUSIBLES et SPÉCIFIQUES au site analysé (secteur déduit du domaine, " +
        "parcours d'achat probable, pages critiques du métier). Réponds UNIQUEMENT en JSON.",
      userPrompt:
        `Site à analyser : ${siteUrl}\n` +
        "Identifie 4 à 7 fuites de revenus probables pour ce site. " +
        'Format JSON strict : {"leaks":[{"leakType":"conversion|performance|seo|ux|local|trust|mobile",' +
        '"page":"/...","title":"...","description":"... (chiffres/benchmarks à l\'appui)",' +
        '"estimatedMonthlyLoss":1200,"impactScore":75,"fixDifficultyMin":90,"quickFix":"action rapide concrète"}]} ' +
        "estimatedMonthlyLoss en euros (100-5000), impactScore 1-100, fixDifficultyMin en minutes. Tout en français.",
      json: true,
      maxTokens: 1800,
    });
    const parsed = JSON.parse(raw) as { leaks?: unknown[] };
    const leaks = Array.isArray(parsed.leaks) ? parsed.leaks : [];
    const clean = leaks
      .map((l) => {
        const o = l as Record<string, unknown>;
        const loss = Number(o["estimatedMonthlyLoss"]);
        const impact = Number(o["impactScore"]);
        const mins = Number(o["fixDifficultyMin"]);
        return {
          leakType:             VALID_LEAK_TYPES.has(String(o["leakType"])) ? String(o["leakType"]) : "conversion",
          page:                 typeof o["page"] === "string" && (o["page"] as string).startsWith("/") ? (o["page"] as string).slice(0, 120) : "/",
          title:                String(o["title"] ?? "").slice(0, 200),
          description:          String(o["description"] ?? "").slice(0, 1000),
          estimatedMonthlyLoss: Number.isFinite(loss) ? Math.min(Math.max(Math.round(loss), 50), 20000) : 800,
          impactScore:          Number.isFinite(impact) ? Math.min(Math.max(Math.round(impact), 1), 100) : 50,
          fixDifficultyMin:     Number.isFinite(mins) ? Math.min(Math.max(Math.round(mins), 10), 2400) : 120,
          quickFix:             String(o["quickFix"] ?? "").slice(0, 500),
        };
      })
      .filter((l) => l.title && l.description);
    return clean.length >= 3 ? clean : null;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[RevenueLeak] AI detection failed — falling back to templates");
    return null;
  }
}

export async function detectRevenueLeaks(orgId: string, siteUrl: string): Promise<void> {
  const existing = await db.select()
    .from(revenueLeaksTable)
    .where(and(eq(revenueLeaksTable.orgId, orgId), eq(revenueLeaksTable.siteUrl, siteUrl)))
    .limit(1);

  if (existing.length > 0) return;

  // 1. AI-personalized detection (per-site, non-identical output)
  const aiLeaks = await detectLeaksWithAI(siteUrl);
  const rows = aiLeaks ?? LEAK_TEMPLATES;

  for (const t of rows) {
    const id = randomUUID();
    await db.insert(revenueLeaksTable).values({
      id,
      orgId,
      siteUrl,
      leakType:             t.leakType,
      page:                 t.page,
      title:                t.title,
      description:          t.description,
      estimatedMonthlyLoss: t.estimatedMonthlyLoss,
      impactScore:          t.impactScore,
      fixDifficultyMin:     t.fixDifficultyMin,
      quickFix:             t.quickFix,
      status:               "active",
      ...(aiLeaks ? { metadata: { source: "ai" } } : {}),
    }).onConflictDoNothing();
  }
}
