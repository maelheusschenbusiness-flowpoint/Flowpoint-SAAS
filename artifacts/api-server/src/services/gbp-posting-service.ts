import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { publishGBPPost } from "./google-service.js";

export type PostType = "standard" | "event" | "offer" | "product";
export type CtaType = "CALL" | "LEARN_MORE" | "ORDER" | "BOOK" | "SIGN_UP" | "SHOP" | "GET_OFFER" | "NONE";
export interface PostGenerationOptions {
  language?: string;
  tone?: string;
  objective?: string;
  industry?: string;
  keywords?: string[];
  maxCharacters?: number;
  eventStartLocal?: string;
  eventEndLocal?: string;
  eventTimezone?: string;
}
const GENERATION_LANGUAGES = new Set(["fr", "en", "nl", "de", "es", "it", "pt"]);
const cleanOption = (value: unknown, max: number): string =>
  String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
function normalizeGenerationOptions(options?: PostGenerationOptions): Required<PostGenerationOptions> {
  const language = String(options?.language || "fr").toLowerCase();
  return {
    language: GENERATION_LANGUAGES.has(language) ? language : "fr",
    tone: cleanOption(options?.tone, 80),
    objective: cleanOption(options?.objective, 120),
    industry: cleanOption(options?.industry, 100),
    keywords: Array.isArray(options?.keywords)
      ? options.keywords.slice(0, 8).map(keyword => cleanOption(keyword, 60)).filter(Boolean)
      : [],
    maxCharacters: Math.max(100, Math.min(1500, Math.floor(Number(options?.maxCharacters) || 500))),
    eventStartLocal: cleanOption(options?.eventStartLocal, 30),
    eventEndLocal: cleanOption(options?.eventEndLocal, 30),
    eventTimezone: cleanOption(options?.eventTimezone, 80),
  };
}

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
  approved_at: string | null;
  generation_options: PostGenerationOptions | null;
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
  offerTerms?: string; approvedAt?: string;
  generationOptions?: PostGenerationOptions;
}): Promise<GBPPost> {
  const client = await pool.connect();
  try {
    const id = `gp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const status = data.scheduledAt ? "scheduled" : "draft";
    await client.query(
      `INSERT INTO gbp_posts (
        id, org_id, location_id, location_name, post_type, title, content,
        cta_type, cta_url, media_urls, event_title, event_start, event_end,
        offer_code, offer_terms, status, scheduled_at, approved_at, seo_keywords, generation_options, ai_generated,
        views, clicks, calls, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false,0,0,0,NOW(),NOW())`,
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
        data.offerTerms ?? null,
        status,
        data.scheduledAt ?? null,
        data.approvedAt ?? null,
        data.seoKeywords ?? [],
        JSON.stringify(normalizeGenerationOptions(data.generationOptions)),
      ]
    );
    const res = await client.query(`SELECT * FROM gbp_posts WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function generateAiPost(orgId: string, data?: { locationId?: string; locationName?: string; postType?: PostType } & PostGenerationOptions): Promise<{ content: string; callToAction: string; type: string }> {
  void orgId;
  const { aiChatCompletion } = await import("../lib/openai-client.js");
  const postType = data?.postType ?? "standard";
  const languageNames: Record<string, string> = { fr: "français", en: "anglais", nl: "néerlandais", de: "allemand", es: "espagnol", it: "italien", pt: "portugais" };
  const options = normalizeGenerationOptions(data);
  const languageCode = options.language;
  const language = languageNames[languageCode] || languageNames.fr;
  const maxCharacters = options.maxCharacters;
  const { keywords, tone, objective, industry } = options;
  const locationName = cleanOption(data?.locationName, 120);
  const ctaByType: Record<string, string> = { standard: "En savoir plus", offer: "Profiter de l’offre", event: "S’inscrire", product: "Découvrir le produit" };
  const raw = await aiChatCompletion({
    systemPrompt: `Tu es un expert en marketing local. Rédige en ${language} un post Google Business Profile exact et utile, sans inventer de prix, d'horaires, de faits ou de promesses. Respecte strictement la limite de ${maxCharacters} caractères, espaces compris. Réponds UNIQUEMENT en JSON: {"content": "...", "callToAction": "..."}`,
    userPrompt: `Rédige un post GBP de type "${postType}"${locationName ? ` pour l'établissement "${locationName}"` : ""}${industry ? ` (secteur: ${industry})` : ""}${keywords.length ? `. Mots-clés à intégrer naturellement: ${keywords.join(", ")}` : ""}${tone ? `. Ton: ${tone}` : ""}${objective ? `. Objectif: ${objective}` : ""}.`,
    json: true,
    maxTokens: 400,
  });
  let parsed: { content?: string; callToAction?: string } = {};
  try { parsed = JSON.parse(raw); } catch { /* handled below */ }
  if (!parsed.content) throw new Error("AI_GENERATION_FAILED");
  if (Array.from(parsed.content).length > maxCharacters) throw new Error("AI_GENERATION_OVER_LIMIT");
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
    if (post.scheduled_at && !post.approved_at) throw new Error("GBP_POST_MANUAL_APPROVAL_REQUIRED");
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
    const postType = String(post.post_type || "standard").toLowerCase();
    if (postType === "product") throw new Error("GBP_POST_TYPE_NOT_SUPPORTED_FOR_PUBLISH");
    const topicType = postType === "event" ? "EVENT" : postType === "offer" ? "OFFER" : "STANDARD";
    const generationOptions = typeof post.generation_options === "string"
      ? (() => { try { return JSON.parse(post.generation_options) as PostGenerationOptions; } catch { return {}; } })()
      : post.generation_options ?? {};
    const callToAction = postType !== "offer" && post.cta_type && post.cta_type !== "NONE"
      ? { actionType: post.cta_type, ...(post.cta_type === "CALL" || !post.cta_url ? {} : { url: post.cta_url }) }
      : undefined;
    const mediaUrls = Array.isArray(post.media_urls) ? post.media_urls : [];
    if (mediaUrls.some(url => typeof url !== "string" || !/^https:\/\//i.test(url))) {
      throw new Error("GBP_MEDIA_URL_INVALID");
    }
    const googleDateTime = (localValue: string | undefined, storedValue: string | null) => {
      const raw = localValue || storedValue || "";
      const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (local) return {
        date: { year: Number(local[1]), month: Number(local[2]), day: Number(local[3]) },
        time: { hours: Number(local[4]), minutes: Number(local[5]) },
      };
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) throw new Error("GBP_EVENT_SCHEDULE_REQUIRED");
      return {
        date: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
        time: { hours: date.getUTCHours(), minutes: date.getUTCMinutes() },
      };
    };
    let event: { title: string; schedule: { startDate: { year: number; month: number; day: number }; startTime: { hours: number; minutes: number }; endDate: { year: number; month: number; day: number }; endTime: { hours: number; minutes: number } } } | undefined;
    if (postType === "event") {
      if (!post.event_title || !post.event_start || !post.event_end) throw new Error("GBP_EVENT_SCHEDULE_REQUIRED");
      const start = googleDateTime(generationOptions.eventStartLocal, post.event_start);
      const end = googleDateTime(generationOptions.eventEndLocal, post.event_end);
      if (new Date(post.event_end).getTime() <= new Date(post.event_start).getTime()) throw new Error("GBP_EVENT_SCHEDULE_INVALID");
      event = { title: post.event_title, schedule: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time } };
    }
    const offer = postType === "offer" ? {
      ...(post.offer_code ? { couponCode: post.offer_code } : {}),
      ...(post.cta_url ? { redeemOnlineUrl: post.cta_url } : {}),
      ...(post.offer_terms ? { termsConditions: post.offer_terms } : {}),
    } : undefined;
    const languageCode = GENERATION_LANGUAGES.has(generationOptions.language || "") ? generationOptions.language : "fr";
    const result = await publishGBPPost(orgId, resourceName, {
      summary: post.content,
      topicType,
      languageCode,
      ...(mediaUrls.length ? { media: mediaUrls.slice(0, 10).map(sourceUrl => ({ mediaFormat: "PHOTO" as const, sourceUrl })) } : {}),
      ...(callToAction ? { callToAction } : {}),
      ...(event ? { event } : {}),
      ...(offer ? { offer } : {}),
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
