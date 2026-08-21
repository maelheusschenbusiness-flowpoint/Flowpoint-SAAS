import { pool } from "@workspace/db";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";

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
  insights: string[];
  recommendations: string[];
}

export interface ReviewItem {
  id: string; author: string; rating: number; text: string;
  sentiment: string; platform: string; replied: boolean;
  date: string; aiSuggestedReply?: string;
}

const SAMPLE_REVIEWS: ReviewItem[] = [
  { id:"rv1", author:"Marie L.", rating:5, text:"Excellent service, résultats visibles en 3 mois ! Mon site est passé de la page 3 à la page 1 sur mes mots-clés principaux.", sentiment:"positive", platform:"google", replied:true, date:new Date(Date.now()-5*24*3600000).toISOString() },
  { id:"rv2", author:"Thomas B.", rating:4, text:"Très bon accompagnement, équipe réactive. Je recommande pour le SEO local.", sentiment:"positive", platform:"google", replied:false, date:new Date(Date.now()-12*24*3600000).toISOString(), aiSuggestedReply:"Merci Thomas pour votre retour positif ! Nous sommes ravis que votre SEO local progresse. N'hésitez pas à nous contacter pour tout ajustement. 🙏" },
  { id:"rv3", author:"Sophie M.", rating:3, text:"Service correct mais délais de réponse parfois longs. Les résultats sont là mais le suivi pourrait être amélioré.", sentiment:"neutral", platform:"google", replied:false, date:new Date(Date.now()-20*24*3600000).toISOString(), aiSuggestedReply:"Merci Sophie pour ce retour constructif. Nous prenons note de votre remarque sur les délais et mettons tout en œuvre pour améliorer notre réactivité. Pouvez-vous nous contacter en DM pour qu'on puisse en discuter ?" },
  { id:"rv4", author:"Pierre D.", rating:2, text:"Résultats décevants par rapport aux promesses. Peu de communication sur l'avancement.", sentiment:"negative", platform:"google", replied:false, date:new Date(Date.now()-30*24*3600000).toISOString(), aiSuggestedReply:"Bonjour Pierre, votre satisfaction est notre priorité. Nous sommes désolés que l'expérience n'ait pas répondu à vos attentes. Contactez-nous directement pour qu'on puisse corriger la situation." },
];

export async function getReputationDashboard(orgId: string): Promise<ReputationDashboard> {
  const client = await pool.connect();
  try {
    // Try reviews table first, fall back to google_reviews, then sample data
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
export async function generateReply(
  reviewOrOrgId: ReviewItem | string,
  reviewTextOrId?: string,
  _tone?: string,
  _language?: string,
): Promise<string> {
  // Extended form: (orgId, textContent, tone, language)
  if (typeof reviewOrOrgId === "string") {
    const text = reviewTextOrId ?? "generic";
    if (text.length < 10) {
      return "Merci pour votre avis. Nous prenons note de vos commentaires.";
    }
    if (text.length < 50) {
      return `Merci pour votre retour. Nous prenons note de vos remarques pour améliorer notre service.`;
    }
    return `Merci pour votre avis détaillé. Votre satisfaction est notre priorité et nous prenons en compte vos remarques. 🙏`;
  }

  // Legacy form: (review: ReviewItem)
  const review = reviewOrOrgId;
  if (review.aiSuggestedReply) return review.aiSuggestedReply;
  if (review.rating >= 4) return `Merci ${review.author.split(" ")[0]} pour votre excellent retour ! Votre satisfaction est notre priorité. 🙏`;
  if (review.rating <= 2) return `Bonjour ${review.author.split(" ")[0]}, nous sommes désolés pour cette expérience. Contactez-nous directement pour trouver une solution. 🤝`;
  return `Merci ${review.author.split(" ")[0]} pour votre retour. Nous prenons note de vos remarques pour améliorer notre service.`;
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
