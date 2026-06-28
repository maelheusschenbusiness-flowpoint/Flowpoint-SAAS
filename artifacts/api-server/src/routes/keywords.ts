import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { db, trackedKeywordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { isDemoMode } from "../services/mock-data.js";
import {
  trackKeyword, syncOrgRankings, getRankingHistory, getKeywordStats,
  generateClusters, generateOpportunities, getAIRecommendations, getKeywordLimit,
} from "../services/keyword-engine.js";
import { logger } from "../lib/logger.js";
import { withCache } from "../middlewares/cacheControl.js";

const router = Router();

type OrgReq = import("express").Request & { orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; orgId?: string };

function getOrg(req: import("express").Request): string {
  return (req as OrgReq).orgId ?? "default";
}
function getPlan(req: import("express").Request): string {
  return ((req as unknown as { me?: { plan?: string } }).me?.plan) ?? "Pro";
}

const SEED: Array<typeof trackedKeywordsTable.$inferInsert> = [
  { id:"kw1", orgId:"default", keyword:"agence seo paris",                currentPosition:3,  prevPosition:5,  searchVolume:1900, difficulty:62, tag:"Local",       intent:"commercial" },
  { id:"kw2", orgId:"default", keyword:"audit seo gratuit",               currentPosition:7,  prevPosition:6,  searchVolume:4400, difficulty:48, tag:"Acquisition", intent:"informational" },
  { id:"kw3", orgId:"default", keyword:"référencement naturel entreprise", currentPosition:12, prevPosition:14, searchVolume:2200, difficulty:55, tag:"Notoriété",   intent:"informational" },
  { id:"kw4", orgId:"default", keyword:"consultant seo freelance",         currentPosition:4,  prevPosition:4,  searchVolume:880,  difficulty:43, tag:"Local",       intent:"commercial" },
  { id:"kw5", orgId:"default", keyword:"optimisation google my business",  currentPosition:2,  prevPosition:3,  searchVolume:3600, difficulty:38, tag:"Local SEO",   intent:"transactional" },
  { id:"kw6", orgId:"default", keyword:"backlinks de qualité",             currentPosition:18, prevPosition:15, searchVolume:1300, difficulty:71, tag:"Netlinking",  intent:"commercial" },
  { id:"kw7", orgId:"default", keyword:"core web vitals optimisation",     currentPosition:9,  prevPosition:11, searchVolume:720,  difficulty:52, tag:"Technique",   intent:"informational" },
  { id:"kw8", orgId:"default", keyword:"seo local restaurant paris",       currentPosition:1,  prevPosition:1,  searchVolume:590,  difficulty:29, tag:"Local",       intent:"navigational" },
];

// GET /api/keywords
router.get("/keywords", withCache(60), async (req, res) => {
  const orgId = getOrg(req);
  const { filter, cluster, intent, device, sortBy = "position" } = req.query as Record<string,string>;
  try {
    let query = `SELECT * FROM tracked_keywords WHERE org_id = $1 AND active = true`;
    const params: unknown[] = [orgId];
    if (filter === "top3")             query += ` AND current_position <= 3`;
    else if (filter === "top10")       query += ` AND current_position <= 10`;
    else if (filter === "top100")      query += ` AND current_position <= 100`;
    else if (filter === "gaining")     query += ` AND trend = 'up'`;
    else if (filter === "losing")      query += ` AND trend = 'down'`;
    else if (filter === "not_ranking") query += ` AND current_position IS NULL`;
    if (cluster) { params.push(cluster); query += ` AND cluster_id = $${params.length}`; }
    if (intent)  { params.push(intent);  query += ` AND intent = $${params.length}`; }
    if (device)  { params.push(device);  query += ` AND device = $${params.length}`; }
    if (sortBy === "volume")          query += ` ORDER BY search_volume DESC`;
    else if (sortBy === "change")     query += ` ORDER BY position_change DESC`;
    else if (sortBy === "volatility") query += ` ORDER BY volatility DESC`;
    else if (sortBy === "created")    query += ` ORDER BY created_at DESC`;
    else                              query += ` ORDER BY current_position ASC NULLS LAST`;
    const kwRes = await (req as OrgReq).orgDb(query, params);
    if (kwRes.rows.length === 0) {
      if (!isDemoMode()) {
        res.json({ keywords: [], total: 0, hasData: false, source: "empty" });
        return;
      }
      // Demo/dev: seed tracked_keywords with sample data
      const existing = await db.select().from(trackedKeywordsTable).limit(1);
      if (existing.length === 0) {
        await db.insert(trackedKeywordsTable).values(SEED).onConflictDoNothing();
      } else {
        for (const s of SEED) {
          await db.update(trackedKeywordsTable).set({ intent: s.intent }).where(eq(trackedKeywordsTable.id, s.id!));
        }
      }
      const seeded = await db.select().from(trackedKeywordsTable)
        .orderBy(trackedKeywordsTable.currentPosition).limit(500);
      res.json({ keywords: seeded, total: seeded.length, source: "seeded" });
      return;
    }
    res.json({ keywords: kwRes.rows, total: kwRes.rows.length, source: "tracked" });
  } catch { res.json({ keywords: [], total: 0, source: "empty" }); }
});

// GET /api/keywords/stats
router.get("/keywords/stats", async (req, res) => {
  const orgId = getOrg(req); const plan = getPlan(req);
  try {
    const stats = await getKeywordStats(orgId);
    res.json({ ...stats, limit: getKeywordLimit(plan), plan });
  } catch { res.json({ keywords: 0, tracked: 0, top10: 0, avgPosition: null, limit: 0, plan: "starter" }); }
});

// GET /api/keywords/opportunities
router.get("/keywords/opportunities", async (req, res) => {
  const orgId = getOrg(req);
  const { type, limit: lim = "20" } = req.query as Record<string,string>;
  try {
    let query = `SELECT * FROM keyword_opportunities WHERE org_id = $1`;
    const params: unknown[] = [orgId];
    if (type) { params.push(type); query += ` AND type = $${params.length}`; }
    query += ` ORDER BY opportunity_score DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await (req as OrgReq).orgDb(query, params);
    res.json({ opportunities: r.rows, count: r.rows.length });
  } catch { res.json({ opportunities: [], count: 0 }); }
});

// GET /api/keywords/clusters
router.get("/keywords/clusters", async (req, res) => {
  const orgId = getOrg(req);
  try {
    const r = await (req as OrgReq).orgDb(
      `SELECT kc.*, COALESCE(COUNT(tk.id),0)::int as kw_count_live
       FROM keyword_clusters kc
       LEFT JOIN tracked_keywords tk ON tk.cluster_id = kc.id AND tk.active = true
       WHERE kc.org_id = $1 GROUP BY kc.id ORDER BY kc.created_at DESC`, [orgId]);
    res.json({ clusters: r.rows, count: r.rows.length });
  } catch { res.json({ clusters: [], count: 0 }); }
});

// GET /api/keywords/alerts
router.get("/keywords/alerts", async (req, res) => {
  const orgId = getOrg(req);
  const { unread_only } = req.query as Record<string,string>;
  try {
    let query = `SELECT * FROM ranking_alerts WHERE org_id = $1`;
    const params: unknown[] = [orgId];
    if (unread_only === "true") query += ` AND read = false`;
    query += ` ORDER BY triggered_at DESC LIMIT 50`;
    const r = await (req as OrgReq).orgDb(query, params);
    res.json({ alerts: r.rows, count: r.rows.length });
  } catch { res.json({ alerts: [], count: 0 }); }
});

// GET /api/keywords/competitor-rankings
router.get("/keywords/competitor-rankings", async (req, res) => {
  const orgId = getOrg(req);
  const { domain } = req.query as Record<string,string>;
  try {
    let query = `SELECT * FROM competitor_rankings WHERE org_id = $1`;
    const params: unknown[] = [orgId];
    if (domain) { params.push(domain); query += ` AND competitor_domain = $${params.length}`; }
    query += ` ORDER BY checked_at DESC LIMIT 100`;
    const r = await (req as OrgReq).orgDb(query, params);
    res.json({ rankings: r.rows, count: r.rows.length });
  } catch { res.json({ rankings: [], count: 0 }); }
});

// GET /api/keywords/ai-recommendations
router.get("/keywords/ai-recommendations", async (req, res) => {
  const orgId = getOrg(req);
  const { domain = "monsite.fr" } = req.query as Record<string,string>;
  try {
    const recs = await getAIRecommendations(orgId, domain);
    res.json(recs);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// GET /api/keywords/:id/history
router.get("/keywords/:id/history", async (req, res) => {
  const orgId = getOrg(req);
  const { days = "30" } = req.query as Record<string,string>;
  try {
    const history = await getRankingHistory(req.params.id, orgId, parseInt(days, 10));
    res.json({ history, count: history.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// POST /api/keywords/track
router.post("/keywords/track", async (req, res) => {
  const orgId = getOrg(req); const plan = getPlan(req);
  const { keyword, url, device, location, language, tag } = req.body as Record<string,string>;
  if (!keyword) { res.status(400).json({ error: "keyword required" }); return; }
  try {
    const id = await trackKeyword(orgId, keyword, { targetUrl: url, device, location, tag });
    res.status(201).json({ ok: true, id, keyword, location: location ?? "France", device: device ?? "desktop" });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("Plan limit") ? 429 : 500).json({ error: msg });
  }
});

// POST /api/keywords/sync
router.post("/keywords/sync", async (req, res) => {
  const orgId = getOrg(req);
  try {
    const result = await syncOrgRankings(orgId);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// POST /api/keywords/cluster
router.post("/keywords/cluster", async (req, res) => {
  const orgId = getOrg(req);
  try {
    const clusters = await generateClusters(orgId);
    res.json({ ok: true, clusters, count: clusters.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// POST /api/keywords/opportunities/generate
router.post("/keywords/opportunities/generate", async (req, res) => {
  const orgId = getOrg(req);
  const { domain = "monsite.fr" } = req.body as { domain?: string };
  try {
    const opps = await generateOpportunities(orgId, domain);
    res.json({ ok: true, opportunities: opps, count: opps.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// PATCH /api/keywords/alerts/:id/read
router.patch("/keywords/alerts/:id/read", async (req, res) => {
  try {
    await (req as OrgReq).orgDb(`UPDATE ranking_alerts SET read = true WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// POST /api/keywords (legacy — inserts into tracked_keywords)
router.post("/keywords", async (req, res) => {
  const orgId = getOrg(req);
  const { keyword, position = 0, volume = 0, difficulty = 50, tag, intent } = req.body as {
    keyword?: string; position?: number; volume?: number; difficulty?: number; tag?: string; intent?: string;
  };
  if (!keyword) { res.status(400).json({ error: "keyword required" }); return; }
  try {
    const id = "kw" + Date.now();
    const r = await (req as OrgReq).orgDb(
      `INSERT INTO tracked_keywords
         (id, org_id, keyword, current_position, prev_position, search_volume, difficulty,
          tag, intent, active, device, location, language, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'desktop','France','fr',NOW(),NOW())
       ON CONFLICT (org_id, keyword, device, location) DO NOTHING
       RETURNING *`,
      [id, orgId, keyword, Number(position), Number(position), Number(volume), Number(difficulty),
       tag || null, intent || null]
    );
    const kw = r.rows[0];
    if (!kw) { res.status(409).json({ error: "Keyword already tracked", keyword }); return; }
    store.logActivity({ type:"audit", label:`Keyword ajouté : ${keyword}`, targetId: String(kw["id"]), targetType:"keyword" }).catch(() => {});
    res.status(201).json(kw);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// PATCH /api/keywords/:id
router.patch("/keywords/:id", async (req, res) => {
  const orgId = getOrg(req);
  try {
    const exists = await (req as OrgReq).orgDb(
      `SELECT id FROM tracked_keywords WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
    if (exists.rows.length > 0) {
      const { tag, cluster_id, active } = req.body as { tag?: string; cluster_id?: string; active?: boolean };
      const updates: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      if (tag !== undefined)        { params.push(tag);        updates.push(`tag = $${params.length}`); }
      if (cluster_id !== undefined) { params.push(cluster_id); updates.push(`cluster_id = $${params.length}`); }
      if (active !== undefined)     { params.push(active);     updates.push(`active = $${params.length}`); }
      params.push(req.params.id);
      await (req as OrgReq).orgDb(`UPDATE tracked_keywords SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      const updated = await (req as OrgReq).orgDb(`SELECT * FROM tracked_keywords WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
      res.json(updated.rows[0]);
    } else {
      res.status(404).json({ error: "not found" });
    }
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

// DELETE /api/keywords/:id
router.delete("/keywords/:id", async (req, res) => {
  const orgId = getOrg(req);
  try {
    const deleted = await (req as OrgReq).orgDb(
      `UPDATE tracked_keywords SET active = false, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING keyword`,
      [req.params.id, orgId]);
    if (deleted.rows.length > 0) {
      store.logActivity({ type:"audit", label:`Keyword retiré : "${deleted.rows[0].keyword}"`, targetId:req.params.id, targetType:"keyword" }).catch(() => {});
    } else {
      res.status(404).json({ error: "not found" });
    }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

export default router;
