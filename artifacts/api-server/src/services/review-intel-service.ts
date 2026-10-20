import { pool } from "@workspace/db";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";
import { aiChat } from "./ai-provider.js";
import { checkAIQuota, recordCompletedUsageDeferred, type AIModel } from "./ai-engine.js";

/** Minimal DB client interface used internally to avoid pool.connect() overload resolution issues. */
interface PoolClientLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}

export interface ReputationDashboard {
  avgRating: number;
  totalReviews: number;
  responseRate: number;
  sentimentScore: number;
  reviews: ReviewItem[];
  trends: Array<{ month: string; rating: number; count: number }>;
  themes: Array<{ theme: string; count: number; negativeCount: number }>;
  priorities: Array<{ theme: string; negativeReviews: number; action: string }>;
  insights: string[];
  recommendations: string[];
}

export interface ReviewItem {
  id: string; author: string; rating: number; text: string;
  sentiment: string; platform: string; replied: boolean;
  date: string; aiSuggestedReply?: string;
}

/** Rule-based themes use stored reviews only; this analysis never calls an AI provider. */
export function summarizeReviewThemes(reviews: ReviewItem[]) {
  const categories = [
    { theme: "Service client", words: ["service", "accueil", "personnel", "équipe", "staff"], action: "Standardiser les bonnes pratiques d’accueil et de suivi." },
    { theme: "Délais", words: ["attente", "retard", "délai", "lent", "rapidité"], action: "Réduire les délais signalés et prévenir les clients en cas d’attente." },
    { theme: "Communication", words: ["communication", "réponse", "contact", "information"], action: "Clarifier les délais de réponse et le suivi après la prestation." },
    { theme: "Qualité", words: ["qualité", "résultat", "défaut", "problème", "erreur"], action: "Examiner les avis concernés et corriger le problème récurrent." },
    { theme: "Prix", words: ["prix", "cher", "tarif", "coût", "facture"], action: "Rendre les tarifs et le détail des prestations plus transparents." },
    { theme: "Ponctualité", words: ["ponctuel", "horaire", "retard"], action: "Confirmer les horaires et prévenir rapidement en cas de retard." },
    { theme: "Propreté", words: ["propreté", "propre", "sale", "nettoyage"], action: "Contrôler la propreté après chaque intervention." },
  ];
  return categories.map(({ theme, words, action }) => {
    const matches = reviews.filter(review => {
      const tokens = String(review.text ?? "")
        .toLocaleLowerCase("fr")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      return words.some(word => {
        const token = word.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
        return tokens.some(candidate => candidate === token || (token.length >= 6 && candidate.startsWith(token)));
      });
    });
    return {
      theme,
      count: matches.length,
      negativeCount: matches.filter(review => review.rating <= 2 || review.sentiment === "negative").length,
      action,
    };
  }).filter(theme => theme.count > 0);
}

export async function getReputationDashboard(orgId: string): Promise<ReputationDashboard> {
  const client = await pool.connect();
  try {
    // Use organization-owned manual reviews first, then fall back to GBP rows.
    const [reviewsRes, googleReviewsRes] = await Promise.allSettled([
      client.query(`SELECT * FROM reviews WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`, [orgId]),
      client.query(
        `SELECT
           id, reviewer_name AS author, rating,
           COALESCE(comment, '') AS text,
           'google' AS platform,
           COALESCE(owner_reply IS NOT NULL, false) AS replied,
           create_time AS date
         FROM google_reviews
         WHERE org_id=$1
         ORDER BY create_time DESC
         LIMIT 100`,
        [orgId]
      ),
    ]);

    let reviews: ReviewItem[] = [];

    if (reviewsRes.status === "fulfilled" && reviewsRes.value.rows.length > 0) {
      reviews = reviewsRes.value.rows as ReviewItem[];
    } else if (googleReviewsRes.status === "fulfilled" && googleReviewsRes.value.rows.length > 0) {
      reviews = (googleReviewsRes.value.rows as Array<Record<string, unknown>>).map(r => ({
        id:        String(r["id"] ?? ""),
        author:    String(r["author"] ?? "Anonyme"),
        rating:    Number(r["rating"] ?? 0),
        text:      String(r["text"] ?? ""),
        sentiment: Number(r["rating"] ?? 0) >= 4 ? "positive" : Number(r["rating"] ?? 0) <= 2 ? "negative" : "neutral",
        platform:  "google",
        replied:   Boolean(r["replied"]),
        date:      r["date"] ? new Date(String(r["date"])).toISOString() : new Date().toISOString(),
      }));
    } else {
      reviews = [];
    }

    const count = reviews.length;
    const avgRating = count > 0 ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / count * 10) / 10 : 0;
    const replied = reviews.filter(r => r.replied).length;
    const positiveCount = reviews.filter(r => r.sentiment === "positive").length;
    const trends = await generateTrendsFromDB(orgId, client);
    const themes = summarizeReviewThemes(reviews);
    const priorities = themes
      .filter(theme => theme.negativeCount > 0)
      .sort((a, b) => b.negativeCount - a.negativeCount || b.count - a.count)
      .slice(0, 3)
      .map(({ theme, negativeCount, action }) => ({ theme, negativeReviews: negativeCount, action }));

    const insights: string[] = count > 0
      ? [
          `Note moyenne de ${avgRating}/5`,
          `${count - replied} avis sans réponse`,
        ]
      : [];
    const recommendations: string[] = count > 0
      ? [
          "Répondre à tous les avis sous 24h pour améliorer la confiance clients",
          "Solliciter activement des avis de clients satisfaits (email post-achat)",
        ]
      : ["Connectez Google Business Profile pour importer vos avis."];

    return {
      avgRating,
      totalReviews: count,
      responseRate: count > 0 ? Math.round((replied / count) * 100) : 0,
      sentimentScore: count > 0 ? Math.round((positiveCount / count) * 100) : 0,
      reviews: reviews.slice(0, 20),
      trends,
      themes,
      priorities,
      insights,
      recommendations,
    };
  } finally { client.release(); }
}

/** Minimal DB client interface used internally by generateTrendsFromDB. */
/**
 * Aggregate review ratings per month from real DB data.
 * Queries google_reviews first (most likely populated), then falls back to reviews table.
 * Returns 6 months of data with count=0 for months with no reviews (never Math.random).
 */
async function generateTrendsFromDB(
  orgId: string,
  client: PoolClientLike
): Promise<Array<{ month: string; rating: number; count: number }>> {
  try {
    // Attempt google_reviews (GBP sync source)
    const res = await client.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', create_time::timestamptz), 'Mon YYYY') AS month,
         ROUND(AVG(rating)::numeric, 1)                                      AS rating,
         COUNT(*)::int                                                        AS count
       FROM google_reviews
       WHERE org_id=$1
         AND create_time > NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', create_time::timestamptz)
       ORDER BY DATE_TRUNC('month', create_time::timestamptz) ASC`,
      [orgId]
    );

    if (res.rows.length > 0) {
      return res.rows.map((r: Record<string, unknown>) => ({
        month:  String(r["month"] ?? ""),
        rating: Number(r["rating"] ?? 0),
        count:  Number(r["count"]  ?? 0),
      }));
    }

    // Fallback: reviews table (manual imports)
    const res2 = await client.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
         ROUND(AVG(rating)::numeric, 1)                        AS rating,
         COUNT(*)::int                                          AS count
       FROM reviews
       WHERE org_id=$1
         AND created_at > NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY DATE_TRUNC('month', created_at) ASC`,
      [orgId]
    );

    if (res2.rows.length > 0) {
      return res2.rows.map((r: Record<string, unknown>) => ({
        month:  String(r["month"] ?? ""),
        rating: Number(r["rating"] ?? 0),
        count:  Number(r["count"]  ?? 0),
      }));
    }
  } catch (e) {
    logger.debug({ e }, "[review-intel] generateTrendsFromDB failed");
  }

  // No real data available — return 6 months of honest zeros (never fabricate ratings)
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return {
      month:  d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }),
      rating: 0,
      count:  0,
    };
  });
}

interface AnalyzeInput {
  id?: string;
  author_name?: string;
  rating?: number;
  review_text: string;
  language?: string;
  location_id?: string;
}

interface AnalyzeResult {
  sentiment: "positive" | "negative" | "neutral";
  score: number;
  strengths: string[];
  weaknesses: string[];
  tips: string[];
  suggestedReply: string;
  topics: string[];
  urgency: string;
}

export async function analyzeReview(
  _orgId: string,
  input: AnalyzeInput | string
): Promise<AnalyzeResult> {
  // Accept both legacy string form and new object form
  const reviewText = typeof input === "string" ? input : (input.review_text ?? "");
  const rating     = typeof input === "string" ? 3 : (input.rating ?? 3);
  const authorName = typeof input === "string" ? "Anonyme" : (input.author_name || "Anonyme");
  const firstName  = authorName.split(" ")[0];

  const lower = reviewText.toLowerCase();

  // ── Positive / Negative lexicon ──────────────────────────────
  const positiveWords  = ["excellent", "parfait", "super", "recommande", "satisfait", "bien", "top", "merci", "génial", "formidable", "great", "perfect", "awesome", "love", "good"];
  const negativeWords  = ["déçu", "mauvais", "problème", "lent", "cher", "nul", "horrible", "décevant", "attente", "jamais", "bad", "terrible", "worst", "awful", "disappointing"];

  const posCount = positiveWords.filter(w => lower.includes(w)).length;
  const negCount = negativeWords.filter(w => lower.includes(w)).length;

  // Use English canonical values ("positive"/"negative"/"neutral") so the DB
  // column is consistent with the google_reviews mapping and the UI filter.
  const sentimentRaw = (rating >= 4 || (posCount > negCount && rating >= 3))
    ? "positive"
    : (rating <= 2 || negCount > posCount)
    ? "negative"
    : "neutral";

  const score = Math.min(10, Math.max(1, Math.round(rating * 2)));

  // ── Strengths / Weaknesses ────────────────────────────────────
  const strengths: string[]   = [];
  const weaknesses: string[]  = [];

  if (sentimentRaw === "positive") {
    if (lower.includes("service"))  strengths.push("Qualité de service saluée");
    if (lower.includes("rapidité") || lower.includes("rapide") || lower.includes("vite")) strengths.push("Réactivité et rapidité appréciées");
    if (lower.includes("résultat") || lower.includes("résultats")) strengths.push("Résultats concrets mentionnés");
    if (lower.includes("équipe") || lower.includes("team"))  strengths.push("Travail d'équipe mis en avant");
    if (strengths.length === 0) strengths.push("Expérience globalement positive");
  } else if (sentimentRaw === "negative") {
    if (lower.includes("attente") || lower.includes("délai") || lower.includes("lent"))  weaknesses.push("Délais jugés trop longs");
    if (lower.includes("cher") || lower.includes("prix") || lower.includes("tarif"))     weaknesses.push("Prix perçu comme élevé");
    if (lower.includes("problème") || lower.includes("erreur") || lower.includes("bug")) weaknesses.push("Problèmes techniques signalés");
    if (lower.includes("communication") || lower.includes("réponse"))                    weaknesses.push("Manque de communication");
    if (weaknesses.length === 0) weaknesses.push("Insatisfaction générale exprimée");
  } else {
    strengths.push("Points positifs mentionnés");
    weaknesses.push("Des axes d'amélioration sont identifiés");
  }

  // ── Tips ─────────────────────────────────────────────────────
  const tips: string[] = [];
  if (sentimentRaw === "positive") {
    tips.push("Demandez à ce client de partager son avis sur Google pour renforcer votre réputation.");
    if (!lower.includes("référence") && !lower.includes("recommande")) {
      tips.push("Proposez-lui un programme de parrainage ou une offre fidélité.");
    }
  } else if (sentimentRaw === "negative") {
    tips.push("Répondez sous 24h pour montrer votre réactivité et limiter l'impact public.");
    tips.push("Proposez une solution concrète ou un contact direct (email/téléphone).");
  } else {
    tips.push("Engagez la conversation pour mieux comprendre les attentes non satisfaites.");
  }

  // ── Suggested reply ───────────────────────────────────────────
  let suggestedReply: string;
  if (sentimentRaw === "positive") {
    suggestedReply = `Merci ${firstName} pour ce retour très positif ! Votre satisfaction est notre plus belle récompense. Nous serons toujours là pour vous accompagner. À bientôt ! 🙏`;
  } else if (sentimentRaw === "negative") {
    suggestedReply = `Bonjour ${firstName}, nous sommes sincèrement désolés que votre expérience n'ait pas été à la hauteur de vos attentes. Votre retour est précieux pour nous améliorer. Pouvez-vous nous contacter directement afin que nous trouvions ensemble une solution ? 🤝`;
  } else {
    suggestedReply = `Merci ${firstName} pour votre retour. Nous prenons note de vos remarques et mettons tout en œuvre pour améliorer continuellement notre service. N'hésitez pas à nous recontacter si vous avez des questions.`;
  }

  const topics = ["service", "qualité", "délais", "prix", "équipe", "résultats"]
    .filter(t => lower.includes(t));

  return {
    sentiment: sentimentRaw,
    score,
    strengths,
    weaknesses,
    tips,
    suggestedReply,
    topics,
    urgency: sentimentRaw === "negative" ? "high" : "low",
  };
}

/**
 * Generate an AI reply for a review.
 * Accepts either:
 *   - Legacy: (review: ReviewItem) — single object form
 *   - Extended: (orgId: string, reviewTextOrId: string, tone?: string, language?: string) — route form
 */
async function generateAIReply(
  orgId: string, reviewText: string, tone: string, language: string, userId = "review-intelligence",
): Promise<string> {
  if (reviewText.trim().length < 5) throw new Error("REVIEW_TEXT_REQUIRED");

  const quota = await checkAIQuota({ feature: "market_intel", orgId });
  if (!quota.allowed) throw new Error("AI_QUOTA_EXCEEDED");

  const startedAt = Date.now();
  try {
    const result = await aiChat({
      task: "market_intel",
      systemPrompt: "Tu rédiges des brouillons de réponse à des avis clients. Réponds uniquement avec le texte du brouillon, dans la langue demandée. N'invente jamais de faits, de compensation ni de résolution. Reste respectueux, spécifique à l'avis, et ne demande aucune donnée personnelle.",
      userPrompt: `Langue : ${language}\nTon : ${tone}\nAvis du client :\n${reviewText.slice(0, 4000)}\n\nRédige une réponse concise et personnalisée. Il s'agit d'un brouillon à relire, pas d'une publication.`,
    });
    const reply = String(result.text ?? "").trim();
    if (!reply) throw new Error("AI_EMPTY_REPLY");
    recordCompletedUsageDeferred({
      feature: "market_intel", orgId, userId,
      model: result._ai.model as AIModel, provider: result._ai.provider,
      tokensIn: result.usage.promptTokens ?? 0,
      tokensOut: result.usage.completionTokens ?? 0,
      latencyMs: Date.now() - startedAt, success: true,
    });
    return reply;
  } catch (error) {
    recordCompletedUsageDeferred({
      feature: "market_intel", orgId, userId,
      model: "gpt-5-mini", provider: "openai",
      tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - startedAt, success: false,
    });
    throw error;
  }
}

export async function generateReply(
  reviewOrOrgId: ReviewItem | string,
  reviewTextOrId?: string,
  tone = "professional",
  language = "fr",
  userId = "review-intelligence",
): Promise<string> {
  if (typeof reviewOrOrgId === "string") {
    return generateAIReply(reviewOrOrgId, String(reviewTextOrId ?? ""), tone, language, userId);
  }
  return generateAIReply(
    "default",
    `${reviewOrOrgId.author} (${reviewOrOrgId.rating}/5): ${reviewOrOrgId.text}`,
    tone,
    language,
  );
}

/** Load a real tenant-owned review before generating its reply draft. */
export async function generateReplyForReview(
  orgId: string, reviewId: string, tone = "professional", language = "fr", userId = "review-intelligence",
): Promise<string> {
  const result = await pool.query<{
    author: string | null; rating: number | null; review_text: string | null;
  }>(
    `SELECT author, rating, review_text
       FROM (
         SELECT reviewer_name AS author, rating, COALESCE(comment, '') AS review_text,
                NULLIF(create_time, '')::timestamptz AS reviewed_at
           FROM google_reviews WHERE id=$1 AND org_id=$2
         UNION ALL
         SELECT author, rating, COALESCE(text, '') AS review_text, created_at AS reviewed_at
           FROM reviews WHERE id=$1 AND org_id=$2
       ) owned_review
      ORDER BY reviewed_at DESC NULLS LAST
      LIMIT 1`,
    [reviewId, orgId],
  );
  const review = result.rows[0];
  if (!review) throw new Error("REVIEW_NOT_FOUND");
  return generateAIReply(
    orgId,
    `${String(review.author ?? "Anonyme")} (${Number(review.rating ?? 0)}/5): ${String(review.review_text ?? "")}`,
    tone,
    language,
    userId,
  );
}

/**
 * Sync reviews from GBP (google_reviews table) into the reviews table.
 * The google_reviews table is populated by google-service.ts syncAll() → GBP API.
 * This function copies new rows into reviews for unified querying.
 *
 * @param orgId     - The organisation ID
 * @param _locationId - Optional location ID (accepted for API compatibility, not used in query)
 */
export async function syncReviewsFromGBP(orgId: string, _locationId?: string): Promise<{ synced: number }> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) {
    logger.info({ orgId }, "[review-intel] syncReviewsFromGBP: no Google token, skipping");
    return { synced: 0 };
  }

  const client = await pool.connect();
  try {
    // Copy any google_reviews not yet in the reviews table
    const result = await client.query(
      `INSERT INTO reviews (id, org_id, author, rating, text, sentiment, platform, replied, created_at)
       SELECT
         gr.id,
         gr.org_id,
         gr.reviewer_name,
         gr.rating,
         COALESCE(gr.comment, ''),
         CASE
           WHEN gr.rating >= 4 THEN 'positive'
           WHEN gr.rating <= 2 THEN 'negative'
           ELSE 'neutral'
         END,
         'google',
         (gr.owner_reply IS NOT NULL),
         gr.create_time::timestamptz
       FROM google_reviews gr
       WHERE gr.org_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM reviews r WHERE r.id = gr.id
         )
       ON CONFLICT (id) DO NOTHING`,
      [orgId]
    );

    const synced = result.rowCount ?? 0;
    logger.info({ orgId, synced }, "[review-intel] syncReviewsFromGBP completed");
    return { synced };
  } catch (e) {
    logger.warn({ e, orgId }, "[review-intel] syncReviewsFromGBP failed");
    return { synced: 0 };
  } finally {
    client.release();
  }
}
