import { pool } from "@workspace/db";

export type PostType = "standard" | "event" | "offer" | "product";
export type CtaType = "CALL" | "LEARN_MORE" | "ORDER" | "BOOK" | "SIGN_UP" | "GET_OFFER" | "NONE";

export interface GBPPost {
  id: string;
  org_id: string;
  location_id: string | null;
  location_name: string | null;
  post_type: string;
  title: string | null;
  content: string;
  cta_type: string | null;
  cta_url: string | null;
  media_urls: string[];
  event_title: string | null;
  event_start: string | null;
  event_end: string | null;
  offer_code: string | null;
  offer_terms: string | null;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduled_at: string | null;
  published_at: string | null;
  google_post_id: string | null;
  views: number;
  clicks: number;
  calls: number;
  ai_generated: boolean;
  seo_keywords: string[];
  created_at: string;
  updated_at: string;
}

export async function getPostsDashboard(orgId: string): Promise<{
  posts: GBPPost[];
  stats: { total: number; published: number; scheduled: number; draft: number; thisMonth: number };
}> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM gbp_posts WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [orgId]
    );
    const posts: GBPPost[] = res.rows;
    return {
      posts,
      stats: {
        total: posts.length,
        published: posts.filter(p => p.status === "published").length,
        scheduled: posts.filter(p => p.status === "scheduled").length,
        draft: posts.filter(p => p.status === "draft").length,
        thisMonth: posts.filter(p => {
          const d = new Date(p.createdAt);
          const now = new Date();
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length,
      },
    };
  } catch { return { posts: [], stats: { total:0, published:0, scheduled:0, draft:0, thisMonth:0 } }; }
  finally { client.release(); }
}

export async function createPost(orgId: string, data: {
  locationId?: string; locationName?: string; postType?: PostType;
  title?: string; content: string; ctaType?: CtaType; ctaUrl?: string;
  mediaUrls?: string[]; scheduledAt?: string; seoKeywords?: string[];
  eventTitle?: string; eventStart?: string; eventEnd?: string; offerCode?: string;
}): Promise<GBPPost> {
  const client = await pool.connect();
  try {
    const id = `gp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const status = data.scheduledAt ? "scheduled" : "draft";
    await client.query(
      `INSERT INTO gbp_posts (
        id, org_id, location_id, location_name, post_type, title, content,
        cta_type, cta_url, media_urls, event_title, event_start, event_end,
        offer_code, status, scheduled_at, seo_keywords, ai_generated,
        views, clicks, calls, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false,0,0,0,NOW(),NOW())`,
      [
        id, orgId,
        data.locationId ?? null,
        data.locationName ?? null,
        data.postType ?? "standard",
        data.title ?? null,
        data.content,
        data.ctaType ?? null,
        data.ctaUrl ?? null,
        data.mediaUrls ?? [],
        data.eventTitle ?? null,
        data.eventStart ?? null,
        data.eventEnd ?? null,
        data.offerCode ?? null,
        status,
        data.scheduledAt ?? null,
        data.seoKeywords ?? [],
      ]
    );
    const res = await client.query(`SELECT * FROM gbp_posts WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function generateAiPost(orgId: string, data?: { locationId?: string; locationName?: string; postType?: PostType; industry?: string; keywords?: string[]; tone?: string; objective?: string; }): Promise<{ content: string; callToAction: string; type: string }> {
  void orgId; void data;
  const templates: Record<string, { content: string; callToAction: string }> = {
    "promo":     { content: `🎉 Offre spéciale cette semaine ! Profitez de notre service premium avec une consultation gratuite de 30 minutes. Réservez maintenant et transformez votre présence en ligne. 📈 #SEO #LocalSEO #Digital`, callToAction: "Réserver" },
    "news":      { content: `📢 Nouvelle mise à jour Google Algorithm ! Suite au récent update, voici les 3 ajustements clés à faire sur votre site pour maintenir votre positionnement. Contactez-nous pour un audit gratuit. 🔍`, callToAction: "En savoir plus" },
    "tip":       { content: `💡 Conseil SEO du jour : Saviez-vous que répondre aux avis Google peut augmenter vos conversions de 33% ? Prenez 5 minutes aujourd'hui pour répondre à vos avis récents. #Tips #SEO`, callToAction: "Nous contacter" },
    "event":     { content: `📅 Webinaire gratuit : "Dominer le SEO Local en 2025" — Rejoignez-nous ce jeudi à 14h pour découvrir les stratégies utilisées par les meilleurs. Places limitées ! Inscrivez-vous maintenant.`, callToAction: "S'inscrire" },
  };
  const postType = data?.postType ?? "tip";
  const type = templates[postType] ? postType : "tip";
  return { type, ...templates[type], isTemplate: true };
}

export async function publishPost(postId: string): Promise<{ ok: boolean; publishedAt: string }> {
  const client = await pool.connect();
  try {
    const now = new Date().toISOString();
    await client.query(
      `UPDATE gbp_posts SET status='published', published_at=$1 WHERE id=$2`,
      [now, postId]
    );
    return { ok: true, publishedAt: now };
  } finally { client.release(); }
}

export async function deletePost(postId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM gbp_posts WHERE id=$1`, [postId]);
  } finally { client.release(); }
}

export async function getScheduledPosts(orgId: string): Promise<GBPPost[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM gbp_posts WHERE org_id=$1 AND status='scheduled' AND scheduled_at > NOW() ORDER BY scheduled_at ASC LIMIT 50`,
      [orgId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}
