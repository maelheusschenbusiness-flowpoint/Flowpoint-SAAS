import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { analyzeReview, generateReply, getReputationDashboard, syncReviewsFromGBP } from "../services/review-intel-service.js";
import { pool } from "@workspace/db";

const router = Router();
const org = (req: import("express").Request) => ((req as unknown as { orgId?: string }).orgId ?? "default");

router.get("/review-intelligence", async (req, res) => {
  try {
    const data = await getReputationDashboard(org(req));
    res.json(data);
  } catch {
    res.json({ reviews: [], totalCount: 0, averageRating: null, sentimentBreakdown: {}, locationBreakdown: [] });
  }
});

router.get("/review-intelligence/reviews", async (req, res) => {
  const { sentiment, rating, location_id, limit: lim = "30" } = req.query as Record<string, string>;
  const client = await pool.connect();
  try {
    let q = `SELECT * FROM review_analysis WHERE org_id=$1`;
    const params: unknown[] = [org(req)];
    if (sentiment) { params.push(sentiment); q += ` AND sentiment=$${params.length}`; }
    if (rating)    { params.push(parseInt(rating, 10)); q += ` AND rating=$${params.length}`; }
    if (location_id) { params.push(location_id); q += ` AND location_id=$${params.length}`; }
    q += ` ORDER BY reviewed_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await client.query(q, params);
    res.json({ reviews: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.post("/review-intelligence/analyze", async (req, res) => {
  const { id, authorName, rating, reviewText, language, locationId } = req.body as {
    id?: string; authorName?: string; rating?: number; reviewText?: string; language?: string; locationId?: string;
  };
  if (!reviewText || rating === undefined) { res.status(400).json({ error: "reviewText et rating requis" }); return; }
  try {
    const result = await analyzeReview(org(req), {
      id: id || `rev_${Date.now()}`,
      author_name: authorName || 'Anonyme',
      rating, review_text: reviewText, language, location_id: locationId,
    });
    res.json({ ok: true, analysis: result });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/review-intelligence/reply/:reviewId", async (req, res) => {
  const { tone = "professional", language = "fr" } = req.body as { tone?: string; language?: string };
  try {
    const reply = await generateReply(org(req), req.params.reviewId, tone, language);
    res.json({ ok: true, reply });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/review-intelligence/reply/:reviewId/publish", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE review_analysis SET reply_status='published', replied_at=now() WHERE id=$1 AND org_id=$2`, [req.params.reviewId, org(req)]);
    res.json({ ok: true, message: "Réponse publiée" });
  } finally { client.release(); }
});

router.get("/review-intelligence/alerts", async (req, res) => {
  const { resolved = "false", limit: lim = "20" } = req.query as Record<string, string>;
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM review_alerts WHERE org_id=$1 AND resolved=$2 ORDER BY created_at DESC LIMIT $3`, [org(req), resolved === 'true', parseInt(lim, 10)]);
    res.json({ alerts: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.patch("/review-intelligence/alerts/:id/resolve", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE review_alerts SET resolved=true WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } finally { client.release(); }
});

router.post("/review-intelligence/sync/:locationId", async (req, res) => {
  try {
    const result = await syncReviewsFromGBP(org(req), req.params.locationId);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/review-intelligence/reputation-score", async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM reputation_scores WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [org(req)]);
    res.json({ score: r.rows[0] || null });
  } finally { client.release(); }
});

export default router;
