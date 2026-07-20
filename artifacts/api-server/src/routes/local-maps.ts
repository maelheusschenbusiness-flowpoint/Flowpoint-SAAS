import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { canWrite } from "../middlewares/requireRole.js";
import {
  createHeatmap, getHeatmaps, getHeatmapDetail,
  getMapsDashboard, generateAiLocalRecommendations,
} from "../services/local-maps-service.js";
import { pool } from "@workspace/db";

const router = Router();
const org = (req: import("express").Request) => ((req as unknown as { orgId?: string }).orgId ?? "default");

router.get("/local-maps", async (req, res) => {
  try {
    const data = await getMapsDashboard(org(req));
    res.json(data);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/local-maps/heatmaps", async (req, res) => {
  try {
    const heatmaps = await getHeatmaps(org(req));
    res.json({ heatmaps, count: heatmaps.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/local-maps/heatmaps/:id", async (req, res) => {
  try {
    const data = await getHeatmapDetail(org(req), req.params.id);
    res.json(data);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/local-maps/heatmaps", canWrite, async (req, res) => {
  const { locationId, name, keyword, centerLat, centerLng, radiusKm, gridSize } = req.body as {
    locationId?: string; name?: string; keyword?: string;
    centerLat?: number; centerLng?: number; radiusKm?: number; gridSize?: number;
  };
  if (!name || !keyword || centerLat === undefined || centerLng === undefined) {
    res.status(400).json({ error: "name, keyword, centerLat, centerLng requis" }); return;
  }
  try {
    const heatmap = await createHeatmap(org(req), { locationId, name, keyword, centerLat, centerLng, radiusKm, gridSize });
    res.status(201).json({ ok: true, heatmap });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.delete("/local-maps/heatmaps/:id", canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM local_heatmaps WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } finally { client.release(); }
});

router.get("/local-maps/competitors", async (req, res) => {
  const { min_authority, in_pack, limit: lim = "20" } = req.query as Record<string, string>;
  const client = await pool.connect();
  try {
    const orgId = org(req);
    // seed if empty
    const cnt = await client.query(`SELECT COUNT(*) FROM competitor_map_results WHERE org_id=$1`, [orgId]);
    if (parseInt(cnt.rows[0].count, 10) === 0) {
      const { seedCompetitorResults } = await import("../services/local-maps-service.js");
      await seedCompetitorResults(orgId);
    }
    let q = `SELECT * FROM competitor_map_results WHERE org_id=$1`;
    const params: unknown[] = [orgId];
    if (min_authority) { params.push(parseInt(min_authority, 10)); q += ` AND authority_score>=$${params.length}`; }
    if (in_pack === 'true') { q += ` AND is_local_pack=true`; }
    q += ` ORDER BY authority_score DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await client.query(q, params);
    res.json({ competitors: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.get("/local-maps/opportunities", async (req, res) => {
  const client = await pool.connect();
  try {
    const orgId = org(req);
    const cnt = await client.query(`SELECT COUNT(*) FROM local_opportunities WHERE org_id=$1`, [orgId]);
    if (parseInt(cnt.rows[0].count, 10) === 0) {
      const { seedLocalOpportunities } = await import("../services/local-maps-service.js");
      await seedLocalOpportunities(orgId);
    }
    const r = await client.query(`SELECT * FROM local_opportunities WHERE org_id=$1 ORDER BY score DESC LIMIT 20`, [orgId]);
    res.json({ opportunities: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.get("/local-maps/visibility-scores", async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM local_visibility_scores WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20`, [org(req)]);
    res.json({ scores: r.rows, count: r.rows.length });
  } finally { client.release(); }
});

router.post("/local-maps/ai-recommendations", canWrite, async (req, res) => {
  try {
    const summary = await generateAiLocalRecommendations(org(req));
    res.json({ ok: true, summary });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

export default router;
