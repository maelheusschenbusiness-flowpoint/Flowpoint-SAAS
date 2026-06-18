import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { createPost, generateAiPost, publishPost, getPostsDashboard, deletePost, getScheduledPosts } from "../services/gbp-posting-service.js";
import { pool } from "@workspace/db";

const router = Router();
const org = (req: import("express").Request) => ((req as unknown as { orgId?: string }).orgId ?? "default");

router.get("/gbp-posts", async (req, res) => {
  try {
    const data = await getPostsDashboard(org(req));
    res.json(data);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/gbp-posts/list", async (req, res) => {
  const { status, location_id, limit: lim = "50" } = req.query as Record<string, string>;
  const client = await pool.connect();
  try {
    let q = `SELECT * FROM gbp_posts WHERE org_id=$1`;
    const params: unknown[] = [org(req)];
    if (status) { params.push(status); q += ` AND status=$${params.length}`; }
    if (location_id) { params.push(location_id); q += ` AND location_id=$${params.length}`; }
    q += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await client.query(q, params);
    res.json({ posts: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.get("/gbp-posts/scheduled", async (req, res) => {
  try {
    const posts = await getScheduledPosts(org(req));
    res.json({ posts, count: posts.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/gbp-posts/queue", async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT q.*, p.content, p.post_type, p.location_name FROM gbp_post_queue q JOIN gbp_posts p ON p.id=q.post_id WHERE q.org_id=$1 ORDER BY q.scheduled_for ASC LIMIT 20`, [org(req)]);
    res.json({ queue: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.post("/gbp-posts", async (req, res) => {
  const { locationId, locationName, postType, title, content, ctaType, ctaUrl, mediaUrls, scheduledAt, seoKeywords, eventTitle, eventStart, eventEnd, offerCode } = req.body as {
    locationId?: string; locationName?: string; postType?: string; title?: string; content?: string;
    ctaType?: string; ctaUrl?: string; mediaUrls?: string[]; scheduledAt?: string;
    seoKeywords?: string[]; eventTitle?: string; eventStart?: string; eventEnd?: string; offerCode?: string;
  };
  if (!locationId || !content) { res.status(400).json({ error: "locationId et content requis" }); return; }
  try {
    const post = await createPost(org(req), { locationId, locationName, postType: postType as import("../services/gbp-posting-service.js").PostType, title, content, ctaType: ctaType as import("../services/gbp-posting-service.js").CtaType, ctaUrl, mediaUrls, scheduledAt, seoKeywords, eventTitle, eventStart, eventEnd, offerCode });
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
    const generated = await generateAiPost(org(req), { locationId, locationName, postType: postType as import("../services/gbp-posting-service.js").PostType, industry, keywords, tone, objective });
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
  const client = await pool.connect();
  try {
    const { content, title, scheduledAt, status, seoKeywords } = req.body as { content?: string; title?: string; scheduledAt?: string; status?: string; seoKeywords?: string[] };
    const updates: string[] = ['updated_at=now()'];
    const params: unknown[] = [];
    if (content)      { params.push(content);                    updates.push(`content=$${params.length}`); }
    if (title)        { params.push(title);                      updates.push(`title=$${params.length}`); }
    if (scheduledAt)  { params.push(scheduledAt);                updates.push(`scheduled_at=$${params.length}`); }
    if (status)       { params.push(status);                     updates.push(`status=$${params.length}`); }
    if (seoKeywords)  { params.push(seoKeywords);                updates.push(`seo_keywords=$${params.length}`); }
    params.push(req.params.id, org(req));
    await client.query(`UPDATE gbp_posts SET ${updates.join(',')} WHERE id=$${params.length-1} AND org_id=$${params.length}`, params);
    res.json({ ok: true });
  } finally { client.release(); }
});

router.delete("/gbp-posts/:id", async (req, res) => {
  try {
    await deletePost(org(req), req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/gbp-posts/media", async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM gbp_media_assets WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`, [org(req)]);
    res.json({ media: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

export default router;
