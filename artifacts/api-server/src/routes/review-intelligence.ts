import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { canWrite } from "../middlewares/requireRole.js";
import {
  analyzeReview, generateReply, getReputationDashboard, syncReviewsFromGBP,
} from "../services/review-intel-service.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

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
  try {
    let q = `SELECT * FROM review_analysis WHERE org_id=$1`;
    const params: unknown[] = [org(req)];
    if (sentiment)   { params.push(sentiment);                q += ` AND sentiment=$${params.length}`; }
    if (rating)      { params.push(parseInt(rating, 10));     q += ` AND rating=$${params.length}`; }
    if (location_id) { params.push(location_id);              q += ` AND location_id=$${params.length}`; }
    q += ` ORDER BY reviewed_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await db(req)(q, params);
    res.json({ reviews: r.rows, count: r.rows.length });
  } catch { res.json({ reviews: [], count: 0 }); }
});

router.post("/review-intelligence/analyze", canWrite, async (req, res) => {
  const { id, authorName, rating, reviewText, language, locationId } = req.body as {
    id?: string; authorName?: string; rating?: number; reviewText?: string;
    language?: string; locationId?: string;
  };
  if (!reviewText || rating === undefined) {
    res.status(400).json({ error: "reviewText et rating requis" }); return;
  }
  try {
    const result = await analyzeReview(org(req), {
      id: id || `rev_${Date.now()}`,
      author_name: authorName || "Anonyme",
      rating, review_text: reviewText, language, location_id: locationId,
    });
    res.json({ ok: true, analysis: result });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/review-intelligence/reply", canWrite, async (req, res) => {
  const { content, tone = "professional", language = "fr" } = req.body as {
    content?: string; tone?: string; language?: string;
  };
  try {
    const reply = await generateReply(org(req), content ?? "generic", tone, language);
    res.json({ ok: true, reply });
  } catch { res.json({ ok: true, reply: "Merci pour votre avis, nous prenons note de vos commentaires." }); }
});

router.post("/review-intelligence/reply/:reviewId", canWrite, async (req, res) => {
  const { tone = "professional", language = "fr" } = req.body as { tone?: string; language?: string };
  try {
    const reply = await generateReply(org(req), String(req.params.reviewId), tone, language);
    res.json({ ok: true, reply });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/review-intelligence/reply/:reviewId/publish", canWrite, async (req, res) => {
  try {
    await db(req)(
      `UPDATE review_analysis SET reply_status='published', replied_at=now() WHERE id=$1 AND org_id=$2`,
      [req.params.reviewId, org(req)]
    );
    res.json({ ok: true, message: "Réponse publiée" });
  } catch { res.status(500).json({ error: "Failed to publish reply" }); }
});

router.get("/review-intelligence/alerts", async (req, res) => {
  const { resolved = "false", limit: lim = "20" } = req.query as Record<string, string>;
  try {
    const r = await db(req)(
      `SELECT * FROM review_alerts WHERE org_id=$1 AND resolved=$2 ORDER BY created_at DESC LIMIT $3`,
      [org(req), resolved === "true", parseInt(lim, 10)]
    );
    res.json({ alerts: r.rows, count: r.rows.length });
  } catch { res.json({ alerts: [], count: 0 }); }
});

router.patch("/review-intelligence/alerts/:id/resolve", canWrite, async (req, res) => {
  try {
    await db(req)(
      `UPDATE review_alerts SET resolved=true WHERE id=$1 AND org_id=$2`,
      [req.params.id, org(req)]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to resolve alert" }); }
});

router.post("/review-intelligence/sync/:locationId", canWrite, async (req, res) => {
  try {
    const result = await syncReviewsFromGBP(org(req), String(req.params.locationId));
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/review-intelligence/reputation-score", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT * FROM reputation_scores WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [org(req)]
    );
    res.json({ score: r.rows[0] || null });
  } catch { res.json({ score: null }); }
});

export default router;
