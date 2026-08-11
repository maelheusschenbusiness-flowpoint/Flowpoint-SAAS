import { randomUUID } from "crypto";
import {
  db,
  croRecommendationsTable,
  croScoresTable,
  croExperimentsTable,
} from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const CRO_ISSUE_TEMPLATES = [
  {
    type: "cta",    priority: "high",   title: "CTA principal peu visible",
    description: "Le bouton d'action principal est en bas de page et non above the fold. 67% des visiteurs ne le voient jamais.",
    implementation: "Dupliquer le CTA en haut de page. Utiliser une couleur contrastante (#2563EB sur fond blanc). Taille min 44px.",
    estimatedUplift: 0.18,
  },
  {
    type: "form",   priority: "high",   title: "Formulaire trop long",
    description: "Le formulaire contient 9 champs alors que le benchmark sectoriel est à 4. Chaque champ supplémentaire réduit le taux de conversion de 11%.",
    implementation: "Supprimer les champs non-essentiels. Déplacer les infos secondaires en étape 2. Ajouter l'autocomplete.",
    estimatedUplift: 0.24,
  },
  {
    type: "layout", priority: "medium", title: "Manque de preuve sociale",
    description: "Aucun témoignage, note ou logo client visible above the fold. La preuve sociale augmente la confiance de +34%.",
    implementation: "Ajouter 3 avis clients avec étoiles. Afficher le nombre de clients ou un logo client reconnu.",
    estimatedUplift: 0.12,
  },
  {
    type: "copy",   priority: "medium", title: "Proposition de valeur floue",
    description: "Le headline principal ne communique pas clairement le bénéfice principal en < 5 secondes.",
    implementation: "Reformuler en structure : [Qui vous aidez] + [Résultat clé] + [Délai/différentiateur]. Ex: 'Doublez vos leads locaux en 30 jours, sans agence.'",
    estimatedUplift: 0.15,
  },
  {
    type: "cta",    priority: "medium", title: "Microcopy CTA générique",
    description: "Le texte 'Soumettre' ou 'Envoyer' réduit le CTR de 22% vs des textes orientés bénéfice.",
    implementation: "Remplacer par : 'Recevoir mon audit gratuit', 'Commencer maintenant', 'Voir mes résultats'.",
    estimatedUplift: 0.08,
  },
  {
    type: "form",   priority: "low",    title: "Pas d'indicateur de progression",
    description: "Les formulaires multi-étapes sans barre de progression ont 36% d'abandon en plus.",
    implementation: "Ajouter une barre 'Étape 1/3' avec indication du temps estimé (< 2 min).",
    estimatedUplift: 0.09,
  },
];

// ── AI generation ────────────────────────────────────────────────────────────
// The CRO Strategist is an AI agent: recommendations are generated per-site by
// the model so two sites never get identical output. The static templates above
// are ONLY a fallback when no AI provider is configured or the call fails, and
// fallback rows are tagged source:"rules" so the UI can label them as generic.
const VALID_CRO_TYPES = new Set(["cta", "form", "layout", "copy", "trust", "speed", "mobile"]);
const VALID_PRIORITIES = new Set(["high", "medium", "low"]);

async function generateCROWithAI(siteUrl: string): Promise<Array<{
  page: string; type: string; priority: string; title: string;
  description: string; implementation: string; estimatedUplift: number;
}> | null> {
  try {
    const { aiChatCompletion } = await import("../lib/openai-client.js");
    const raw = await aiChatCompletion({
      systemPrompt:
        "Tu es un consultant CRO senior spécialisé PME/agences francophones. " +
        "Tu produis des recommandations d'optimisation de conversion CONCRÈTES et SPÉCIFIQUES au site analysé " +
        "(secteur déduit du domaine, type de pages, vocabulaire du métier). Réponds UNIQUEMENT en JSON.",
      userPrompt:
        `Site à analyser : ${siteUrl}\n` +
        "Génère 6 à 10 recommandations CRO réparties sur les pages probables du site " +
        "(accueil, contact, services/produits, tarifs). " +
        'Format JSON strict : {"recommendations":[{"page":"/","type":"cta|form|layout|copy|trust|speed|mobile",' +
        '"priority":"high|medium|low","title":"...","description":"... (chiffres/benchmarks à l\'appui)",' +
        '"implementation":"étapes concrètes","estimatedUplift":0.12}]} ' +
        "estimatedUplift est un ratio entre 0.03 et 0.30. Tout le texte en français.",
      json: true,
      maxTokens: 2000,
    });
    const parsed = JSON.parse(raw) as { recommendations?: unknown[] };
    const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    const clean = recs
      .map((r) => {
        const o = r as Record<string, unknown>;
        const uplift = Number(o["estimatedUplift"]);
        return {
          page:            typeof o["page"] === "string" && (o["page"] as string).startsWith("/") ? (o["page"] as string).slice(0, 120) : "/",
          type:            VALID_CRO_TYPES.has(String(o["type"])) ? String(o["type"]) : "layout",
          priority:        VALID_PRIORITIES.has(String(o["priority"])) ? String(o["priority"]) : "medium",
          title:           String(o["title"] ?? "").slice(0, 200),
          description:     String(o["description"] ?? "").slice(0, 1000),
          implementation:  String(o["implementation"] ?? "").slice(0, 1000),
          estimatedUplift: Number.isFinite(uplift) ? Math.min(Math.max(uplift, 0.01), 0.5) : 0.1,
        };
      })
      .filter((r) => r.title && r.description);
    return clean.length >= 3 ? clean : null;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[CRO] AI generation failed — falling back to rule templates");
    return null;
  }
}

export async function generateCRORecommendations(orgId: string, siteUrl: string): Promise<void> {
  try {
    const existingCount = await db.select()
      .from(croRecommendationsTable)
      .where(and(
        eq(croRecommendationsTable.orgId, orgId),
        eq(croRecommendationsTable.siteUrl, siteUrl),
      ))
      .limit(1);

    if (existingCount.length > 0) return;

    // 1. AI-personalized generation (per-site, non-identical output)
    const aiRecs = await generateCROWithAI(siteUrl);
    if (aiRecs) {
      for (const r of aiRecs) {
        await db.insert(croRecommendationsTable).values({
          id:              randomUUID(),
          orgId,
          siteUrl,
          page:            r.page,
          type:            r.type,
          priority:        r.priority,
          title:           r.title,
          description:     r.description,
          implementation:  r.implementation,
          estimatedUplift: r.estimatedUplift,
          status:          "pending",
          aiGenerated:     true,
          source:          "ai",
          metadata:        { confidence: 0.75, model: "openai" },
        }).onConflictDoNothing();
      }
      await upsertCROScore(orgId, siteUrl, "/");
      return;
    }

    // 2. Fallback: deterministic rule templates (AI unavailable) — tagged "rules"
    const pages = ["/", "/contact", "/services", "/tarifs"];
    for (const page of pages) {
      const pageHash = page.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0);
      const count = (pageHash % 3) + 2;
      const templates = CRO_ISSUE_TEMPLATES.slice(0, count);

      for (const t of templates) {
        const id = randomUUID();
        await db.insert(croRecommendationsTable).values({
          id,
          orgId,
          siteUrl,
          page,
          type:            t.type,
          priority:        t.priority,
          title:           t.title,
          description:     t.description,
          implementation:  t.implementation,
          estimatedUplift: t.estimatedUplift,
          status:          "pending",
          aiGenerated:     false,
          source:          "rules",
          metadata:        { confidence: 0.85 },
        }).onConflictDoNothing();
      }
    }

    await upsertCROScore(orgId, siteUrl, "/");
  } catch (err) {
    logger.error({ err }, "[CRO] Failed to generate recommendations");
  }
}

export async function upsertCROScore(orgId: string, siteUrl: string, page: string): Promise<void> {
  try {
    const id = `crs_${orgId}_${siteUrl}_${page}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 80);

    const [recRow] = await db.select({
      highCount:   sql<number>`count(*) filter (where priority = 'high')`,
      medCount:    sql<number>`count(*) filter (where priority = 'medium')`,
      totalUplift: sql<number>`sum(estimated_uplift)`,
    }).from(croRecommendationsTable)
      .where(and(
        eq(croRecommendationsTable.orgId, orgId),
        eq(croRecommendationsTable.siteUrl, siteUrl),
      ));

    const highCount   = Number(recRow?.highCount  ?? 2);
    const medCount    = Number(recRow?.medCount   ?? 2);
    const totalUplift = Number(recRow?.totalUplift ?? 0.5);

    const score         = Math.max(20, Math.min(95, 100 - highCount * 12 - medCount * 5));
    const frictionScore = Math.max(20, score - 8);
    const ctaScore      = Math.min(95, score + 5);
    const formScore     = Math.max(15, score - 15);
    const mobileScore   = Math.max(20, score - 6);
    const copyScore     = Math.min(95, score + 3);

    void totalUplift;

    await db.insert(croScoresTable).values({
      id,
      orgId,
      siteUrl,
      page,
      overallScore: score,
      frictionScore,
      ctaScore,
      formScore,
      mobileScore,
      copyScore,
    }).onConflictDoNothing();
  } catch { /* silent */ }
}

export async function getCROData(orgId: string, siteUrl?: string): Promise<{
  recommendations: Array<typeof croRecommendationsTable.$inferSelect>;
  scores:          Array<typeof croScoresTable.$inferSelect>;
  experiments:     Array<typeof croExperimentsTable.$inferSelect>;
  summary: { totalRecs: number; highPriority: number; estimatedUpliftTotal: number; implementedCount: number };
}> {
  const recWhere   = siteUrl
    ? and(eq(croRecommendationsTable.orgId, orgId), eq(croRecommendationsTable.siteUrl, siteUrl))
    : eq(croRecommendationsTable.orgId, orgId);
  const scoreWhere = siteUrl
    ? and(eq(croScoresTable.orgId, orgId), eq(croScoresTable.siteUrl, siteUrl))
    : eq(croScoresTable.orgId, orgId);

  const [recs, scores, exps] = await Promise.all([
    db.select().from(croRecommendationsTable).where(recWhere).orderBy(desc(croRecommendationsTable.createdAt)).limit(30),
    db.select().from(croScoresTable).where(scoreWhere).limit(20),
    db.select().from(croExperimentsTable).where(eq(croExperimentsTable.orgId, orgId)).orderBy(desc(croExperimentsTable.createdAt)).limit(10),
  ]);

  const highPriority         = recs.filter(r => r.priority === "high").length;
  const estimatedUpliftTotal = Math.round(recs.reduce((s, r) => s + (r.estimatedUplift ?? 0), 0) * 100);
  const implementedCount     = recs.filter(r => r.status === "implemented").length;

  return {
    recommendations: recs,
    scores,
    experiments: exps,
    summary: { totalRecs: recs.length, highPriority, estimatedUpliftTotal, implementedCount },
  };
}
