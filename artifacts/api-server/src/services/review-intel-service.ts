import { pool } from "@workspace/db";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";

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

/**
 * Aggregate review ratings per month from real DB data.
 * Queries google_reviews first (most likely populated), then falls back to reviews table.
 * Returns 6 months of data with count=0 for months with no reviews (never Math.random).
 */
async function generateTrendsFromDB(
  orgId: string,
  client: Awaited<ReturnType<typeof pool.connect>>
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
      return res.rows.map(r => ({
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
      return res2.rows.map(r => ({
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

export async function analyzeReview(reviewText: string): Promise<{ sentiment: string; topics: string[]; urgency: string }> {
  const lower = reviewText.toLowerCase();
  const positive = ["excellent", "parfait", "super", "recommande", "satisfait"].some(w => lower.includes(w));
  const negative = ["déçu", "mauvais", "problème", "lent", "cher"].some(w => lower.includes(w));
  return {
    sentiment: positive && !negative ? "positive" : negative ? "negative" : "neutral",
    topics: ["service", "qualité", "délais"].filter(t => lower.includes(t)),
    urgency: negative ? "high" : "low",
  };
}

export async function generateReply(review: ReviewItem): Promise<string> {
  if (review.aiSuggestedReply) return review.aiSuggestedReply;
  if (review.rating >= 4) return `Merci ${review.author.split(" ")[0]} pour votre excellent retour ! Votre satisfaction est notre priorité. 🙏`;
  if (review.rating <= 2) return `Bonjour ${review.author.split(" ")[0]}, nous sommes désolés pour cette expérience. Contactez-nous directement pour trouver une solution. 🤝`;
  return `Merci ${review.author.split(" ")[0]} pour votre retour. Nous prenons note de vos remarques pour améliorer notre service.`;
}

/**
 * Sync reviews from GBP (google_reviews table) into the reviews table.
 * The google_reviews table is populated by google-service.ts syncAll() → GBP API.
 * This function copies new rows into reviews for unified querying.
 */
export async function syncReviewsFromGBP(orgId: string): Promise<number> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) {
    logger.info({ orgId }, "[review-intel] syncReviewsFromGBP: no Google token, skipping");
    return 0;
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
    return synced;
  } catch (e) {
    logger.warn({ e, orgId }, "[review-intel] syncReviewsFromGBP failed");
    return 0;
  } finally {
    client.release();
  }
}
