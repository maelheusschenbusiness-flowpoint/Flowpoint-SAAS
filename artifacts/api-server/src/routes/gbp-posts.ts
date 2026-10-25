import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  createPost, generateAiPost, publishPost, getPostsDashboard, deletePost, getScheduledPosts,
} from "../services/gbp-posting-service.js";
import { requireAddon, requireFeature } from "../middlewares/planGate.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// Draft/read/publish access follows the canonical gbpPosting feature flag.
// AI suggestions remain independently gated by the aiGbpPosting add-on below.
router.use("/gbp-posts", requireFeature("gbpPosting", "GBP Posting"));

router.get("/gbp-posts", async (req, res) => {
  try {
    const data = await getPostsDashboard(org(req));
    res.json(data);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/gbp-posts/list", async (req, res) => {
  const { status, location_id, limit: lim = "50" } = req.query as Record<string, string>;
  try {
    let q = `SELECT * FROM gbp_posts WHERE org_id=$1`;
    const params: unknown[] = [org(req)];
    if (status)      { params.push(status);      q += ` AND status=$${params.length}`; }
    if (location_id) { params.push(location_id); q += ` AND location_id=$${params.length}`; }
    q += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await db(req)(q, params);
    res.json({ posts: r.rows, count: r.rows.length });
  } catch { res.json({ posts: [], count: 0 }); }
});

router.get("/gbp-posts/scheduled", async (req, res) => {
  try {
    const posts = await getScheduledPosts(org(req));
    res.json({ posts, count: posts.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/gbp-posts/queue", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT q.*, p.content, p.post_type, p.location_name
       FROM gbp_post_queue q JOIN gbp_posts p ON p.id=q.post_id
       WHERE q.org_id=$1 ORDER BY q.scheduled_for ASC LIMIT 20`,
      [org(req)]
    );
    res.json({ queue: r.rows, count: r.rows.length });
  } catch { res.json({ queue: [], count: 0 }); }
});

router.post("/gbp-posts", async (req, res) => {
  const {
    locationId, locationName, postType, title, content, ctaType, ctaUrl,
    mediaUrls, scheduledAt, seoKeywords, eventTitle, eventStart, eventEnd, offerCode, offerTerms, manualApproval,
    generationOptions,
  } = req.body as {
    locationId?: string; locationName?: string; postType?: string; title?: string; content?: string;
    ctaType?: string; ctaUrl?: string; mediaUrls?: string[]; scheduledAt?: string;
    seoKeywords?: string[]; eventTitle?: string; eventStart?: string; eventEnd?: string; offerCode?: string; offerTerms?: string;
    manualApproval?: boolean;
    generationOptions?: import("../services/gbp-posting-service.js").PostGenerationOptions;
  };
  if (!content) { res.status(400).json({ error: "content requis" }); return; }
  if (content.length > 1500) { res.status(400).json({ error: "content trop long (1500 caractères maximum)" }); return; }
  if (postType && !["standard", "event", "offer", "product"].includes(postType)) {
    res.status(400).json({ error: "Format de post non pris en charge." }); return;
  }
  if (scheduledAt && postType === "product") {
    res.status(422).json({ error: "L’API Google connectée ne prend pas en charge les posts Produit. Enregistrez ce format comme brouillon." }); return;
  }
  if (scheduledAt && manualApproval !== true) {
    res.status(400).json({ error: "Confirmez la validation manuelle du contenu avant de le programmer." }); return;
  }
  if (scheduledAt && postType === "event" && (!eventTitle?.trim() || !eventStart || !eventEnd)) {
    res.status(400).json({ error: "Le titre, l’heure de début et l’heure de fin sont requis pour programmer un événement." }); return;
  }
  if (postType === "event" && (eventStart || eventEnd) &&
      (!eventTitle?.trim() || !eventStart || !eventEnd || !Number.isFinite(Date.parse(eventStart)) ||
       !Number.isFinite(Date.parse(eventEnd)) || Date.parse(eventEnd) <= Date.parse(eventStart))) {
    res.status(400).json({ error: "Un titre et une plage de dates valide sont requis pour un événement." }); return;
  }
  if (ctaType && !["CALL", "LEARN_MORE", "ORDER", "BOOK", "SIGN_UP", "SHOP", "GET_OFFER", "NONE"].includes(ctaType)) {
    res.status(400).json({ error: "Type de bouton d’action non pris en charge." }); return;
  }
  if (mediaUrls !== undefined && (!Array.isArray(mediaUrls) || mediaUrls.length > 10 ||
      mediaUrls.some(url => typeof url !== "string" || !/^https:\/\//i.test(url)))) {
    res.status(400).json({ error: "Ajoutez au maximum 10 URL d’image publiques en HTTPS." }); return;
  }
  if (ctaUrl) {
    try { if (new URL(ctaUrl).protocol !== "https:") throw new Error("invalid scheme"); }
    catch { res.status(400).json({ error: "Le lien du bouton doit être une URL HTTPS valide." }); return; }
  }
  if (scheduledAt && (!locationId || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) {
    res.status(400).json({ error: "Un établissement connecté et une date future valide sont requis pour planifier." }); return;
  }
  try {
    type PostType = import("../services/gbp-posting-service.js").PostType;
    type CtaType  = import("../services/gbp-posting-service.js").CtaType;
    const post = await createPost(org(req), {
      locationId, locationName, postType: postType as PostType, title, content,
      ctaType: ctaType as CtaType, ctaUrl, mediaUrls, scheduledAt,
      seoKeywords, eventTitle, eventStart, eventEnd, offerCode, offerTerms,
      generationOptions: {
        ...generationOptions,
        eventStartLocal: generationOptions?.eventStartLocal || eventStart,
        eventEndLocal: generationOptions?.eventEndLocal || eventEnd,
      },
      approvedAt: scheduledAt && manualApproval === true ? new Date().toISOString() : undefined,
    });
    res.status(201).json({ ok: true, post });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// AI post generation requires the aiGbpPosting add-on
router.post("/gbp-posts/ai-generate", requireAddon("aiGbpPosting", "AI GBP Posting"), async (req, res) => {
  const { locationId, locationName, postType, industry, keywords, tone, objective, language, maxCharacters } = req.body as {
    locationId?: string; locationName?: string; postType?: string; industry?: string;
    keywords?: string[]; tone?: string; objective?: string; language?: string; maxCharacters?: number;
  };
  if (!locationId) { res.status(400).json({ error: "locationId requis" }); return; }
  try {
    type PostType = import("../services/gbp-posting-service.js").PostType;
    const generated = await generateAiPost(org(req), {
      locationId, locationName, postType: postType as PostType, industry, keywords, tone, objective, language, maxCharacters,
    });
    res.json({ ok: true, ...generated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const overLimit = message === "AI_GENERATION_OVER_LIMIT";
    res.status(overLimit ? 422 : 500).json({
      error: overLimit ? message : safeErrMsg(err),
    });
  }
});

router.post("/gbp-posts/:id/publish", async (req, res) => {
  try {
    const post = await publishPost(org(req), req.params.id);
    res.json({ ok: true, post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const validationErrors = [
      "GBP_POST_TYPE_NOT_SUPPORTED_FOR_PUBLISH",
      "GBP_EVENT_SCHEDULE_REQUIRED",
      "GBP_EVENT_SCHEDULE_INVALID",
      "GBP_MEDIA_URL_INVALID",
    ];
    const isValidationError = validationErrors.includes(message);
    res.status(isValidationError ? 422 : 500).json({
      error: isValidationError ? message : safeErrMsg(err),
    });
  }
});

router.patch("/gbp-posts/:id", async (req, res) => {
  const { content, title, scheduledAt, status, seoKeywords } = req.body as {
    content?: string; title?: string; scheduledAt?: string; status?: string; seoKeywords?: string[];
  };
  const updates: string[] = ["updated_at=now()"];
  const params: unknown[] = [];
  if (content)     { params.push(content);     updates.push(`content=$${params.length}`); }
  if (title)       { params.push(title);       updates.push(`title=$${params.length}`); }
  if (scheduledAt) { params.push(scheduledAt); updates.push(`scheduled_at=$${params.length}`); }
  if (status)      { params.push(status);      updates.push(`status=$${params.length}`); }
  if (seoKeywords) { params.push(seoKeywords); updates.push(`seo_keywords=$${params.length}`); }
  params.push(req.params.id, org(req));
  try {
    await db(req)(
      `UPDATE gbp_posts SET ${updates.join(",")} WHERE id=$${params.length - 1} AND org_id=$${params.length}`,
      params
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Update failed" }); }
});

router.delete("/gbp-posts/:id", async (req, res) => {
  try {
    await deletePost(org(req), req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/gbp-posts/media", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT * FROM gbp_media_assets WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [org(req)]
    );
    res.json({ media: r.rows, count: r.rows.length });
  } catch { res.json({ media: [], count: 0 }); }
});

export default router;
