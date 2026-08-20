import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  createPost, generateAiPost, publishPost, getPostsDashboard, deletePost, getScheduledPosts,
} from "../services/gbp-posting-service.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

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
    mediaUrls, scheduledAt, seoKeywords, eventTitle, eventStart, eventEnd, offerCode,
  } = req.body as {
    locationId?: string; locationName?: string; postType?: string; title?: string; content?: string;
    ctaType?: string; ctaUrl?: string; mediaUrls?: string[]; scheduledAt?: string;
    seoKeywords?: string[]; eventTitle?: string; eventStart?: string; eventEnd?: string; offerCode?: string;
  };
  // locationId is optional for drafts — use 'default' as fallback so brouillon saves always work
  const effectiveLocationId = locationId || 'default';
  if (!content) { res.status(400).json({ error: "content requis" }); return; }
  try {
    type PostType = import("../services/gbp-posting-service.js").PostType;
    type CtaType  = import("../services/gbp-posting-service.js").CtaType;
    const post = await createPost(org(req), {
      locationId: effectiveLocationId, locationName, postType: postType as PostType, title, content,
      ctaType: ctaType as CtaType, ctaUrl, mediaUrls, scheduledAt,
      seoKeywords, eventTitle, eventStart, eventEnd, offerCode,
    });
    res.status(201).json({ ok: true, post });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/gbp-posts/ai-generate", async (req, res) => {
  const { locationId, locationName, postType, industry, keywords, tone, objective } = req.body as {
    locationId?: string; locationName?: string; postType?: string; industry?: string;
    keywords?: string[]; tone?: string; objective?: string;
  };
  if (!locationId) { res.status(400).json({ error: "locationId requis" }); return; }
  try {
    type PostType = import("../services/gbp-posting-service.js").PostType;
    const generated = await generateAiPost(org(req), {
      locationId, locationName, postType: postType as PostType, industry, keywords, tone, objective,
    });
    res.json({ ok: true, ...generated });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/gbp-posts/:id/publish", async (req, res) => {
  try {
    const post = await publishPost(org(req), req.params.id);
    res.json({ ok: true, post });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
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
