import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { publishGBPPost } from "./google-service.js";

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
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
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
          const d = new Date(p.created_at);
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
  void orgId;
  const { aiChatCompletion } = await import("../lib/openai-client.js");
  const postType = data?.postType ?? "tip";
  const ctaByType: Record<string, string> = { promo: "Réserver", news: "En savoir plus", tip: "Nous contacter", event: "S'inscrire" };
  const raw = await aiChatCompletion({
    systemPrompt: `Tu es un expert en marketing local français. Tu rédiges des posts Google Business Profile courts (300-500 caractères), engageants, avec 1-2 émojis pertinents et des hashtags. Réponds UNIQUEMENT en JSON: {"content": "...", "callToAction": "..."}`,
    userPrompt: `Rédige un post GBP de type "${postType}"${data?.locationName ? ` pour l'établissement "${data.locationName}"` : ""}${data?.industry ? ` (secteur: ${data.industry})` : ""}${data?.keywords?.length ? `. Mots-clés à intégrer: ${data.keywords.join(", ")}` : ""}${data?.tone ? `. Ton: ${data.tone}` : ""}${data?.objective ? `. Objectif: ${data.objective}` : ""}.`,
    json: true,
    maxTokens: 400,
  });
  let parsed: { content?: string; callToAction?: string } = {};
  try { parsed = JSON.parse(raw); } catch { /* handled below */ }
  if (!parsed.content) throw new Error("AI_GENERATION_FAILED");
  return { type: postType, content: parsed.content, callToAction: parsed.callToAction || ctaByType[postType] || "En savoir plus" };
}

export async function publishPost(orgId: string, postId: string): Promise<{ ok: boolean; publishedAt: string; googlePostId?: string }> {
  const claimed = await pool.query(
    `UPDATE gbp_posts
        SET status='publishing', updated_at=NOW()
      WHERE id=$1 AND org_id=$2 AND status IN ('draft','scheduled','failed')
      RETURNING *`,
    [postId, orgId],
  );
  const post = claimed.rows[0] as GBPPost | undefined;
  if (!post) throw new Error("GBP_POST_NOT_FOUND_OR_ALREADY_PUBLISHED");
  try {
    if (!post.location_id) throw new Error("GBP_LOCATION_REQUIRED");
    const location = await pool.query(
      `SELECT raw_data->>'name' AS resource_name
         FROM google_locations
        WHERE org_id=$1 AND (id=$2 OR raw_data->>'name'=$2)
        LIMIT 1`,
      [orgId, post.location_id],
    );
    const resourceName = String(location.rows[0]?.resource_name ?? "");
    const resourceParts = resourceName.split("/");
    if (resourceParts.length !== 4 || resourceParts[0] !== "accounts" || !resourceParts[1] || resourceParts[2] !== "locations" || !resourceParts[3]) {
      throw new Error("GBP_LOCATION_NOT_VERIFIED_FOR_ORG");
    }
    if (String(post.post_type).toLowerCase() !== "standard") {
      throw new Error("GBP_POST_TYPE_NOT_SUPPORTED_FOR_PUBLISH");
    }
    const callToAction = post.cta_type && post.cta_url
      ? { actionType: post.cta_type, url: post.cta_url }
      : undefined;
    const result = await publishGBPPost(orgId, resourceName, {
      summary: post.content,
      ...(callToAction ? { callToAction } : {}),
    });
    if (!result.ok) throw new Error(result.error || "GBP_PUBLISH_FAILED");
    const publishedAt = new Date().toISOString();
    await pool.query(
      `UPDATE gbp_posts
          SET status='published', published_at=$1, google_post_id=$2, updated_at=NOW()
        WHERE id=$3 AND org_id=$4 AND status='publishing'`,
      [publishedAt, result.postName ?? null, postId, orgId],
    );
    return { ok: true, publishedAt, ...(result.postName ? { googlePostId: result.postName } : {}) };
  } catch (error) {
    await pool.query(
      `UPDATE gbp_posts SET status='failed', updated_at=NOW()
        WHERE id=$1 AND org_id=$2 AND status='publishing'`,
      [postId, orgId],
    ).catch(() => {});
    throw error;
  }
}

export async function deletePost(orgId: string, postId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM gbp_posts WHERE id=$1 AND org_id=$2`, [postId, orgId]);
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

/** Publish due scheduled posts through the already-authorized GBP token. */
export async function publishDueScheduledPosts(): Promise<{ attempted: number; published: number }> {
  const due = await pool.query(
    `SELECT id, org_id FROM gbp_posts
      WHERE status='scheduled' AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC LIMIT 20`,
  );
  let published = 0;
  for (const row of due.rows as Array<{ id: string; org_id: string }>) {
    try {
      await publishPost(row.org_id, row.id);
      published++;
    } catch {
      logger.warn({ orgId: row.org_id, postId: row.id }, "[gbp-posting] scheduled publish failed");
    }
  }
  return { attempted: due.rows.length, published };
}

export function startGBPPostScheduler(): void {
  let active = false;
  const tick = async () => {
    if (active) return;
    active = true;
    try { await publishDueScheduledPosts(); }
    catch (error) { logger.warn({ error }, "[gbp-posting] scheduled poll failed"); }
    finally { active = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref?.();
  void tick();
}
