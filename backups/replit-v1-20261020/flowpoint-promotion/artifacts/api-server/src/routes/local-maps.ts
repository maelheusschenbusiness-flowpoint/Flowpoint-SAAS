import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { canWrite } from "../middlewares/requireRole.js";
import {
  createHeatmap, getHeatmaps, getHeatmapDetail,
  getMapsDashboard, generateAiLocalRecommendations,
} from "../services/local-maps-service.js";
import { pool } from "@workspace/db";
import { isDataForSEOConfigured, checkAndIncrementQuota, getGoogleMapsResults } from "../services/dataforseo-service.js";
import { requireAddon } from "../middlewares/planGate.js";

const router = Router();

// localDominationMaps is a purchasable add-on (any plan).
router.use("/local-maps", requireAddon("localDominationMaps", "Local Domination Maps"));
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

router.post("/local-maps/competitors/discover", canWrite, async (req, res) => {
  const { keyword, location } = req.body as { keyword?: string; location?: string };
  const orgId = org(req);
  if (!keyword?.trim() || !location?.trim() || keyword.length > 180 || location.length > 180) {
    res.status(400).json({ error: "Mot-clé et emplacement valides requis." }); return;
  }
  if (!await isDataForSEOConfigured(orgId)) {
    res.json({ ok: false, configured: false, competitors: [], message: "DataForSEO n’est pas configuré pour cette organisation." }); return;
  }
  if (!await checkAndIncrementQuota(orgId, 1)) {
    res.status(429).json({ error: "Le quota DataForSEO du jour est atteint.", code: "DATAFORSEO_QUOTA_EXCEEDED" }); return;
  }
  try {
    const normalizedKeyword = keyword.trim();
    const normalizedLocation = location.trim();
    const lookup = await getGoogleMapsResults(normalizedKeyword, normalizedLocation, orgId);
    if (lookup.error) {
      res.status(502).json({ ok: false, configured: true, competitors: [], error: "La recherche locale est indisponible. Réessayez dans un instant." });
      return;
    }
    const results = lookup.results;
    const client = await pool.connect();
    try {
      for (const [idx, item] of results.entries()) {
        const placeId = item.placeId || `result_${idx}_${Buffer.from(`${item.name}|${item.address}|${item.rank}`).toString("base64url")}`;
        const id = `map_${Buffer.from(`${orgId}|${normalizedKeyword}|${normalizedLocation}|${placeId}`).toString("base64url").slice(0, 64)}`;
        const authority = Math.min(100, Math.round((Number(item.rating) / 5) * 55 + Math.min(Number(item.reviews), 500) / 500 * 45));
        await client.query(
          `INSERT INTO competitor_map_results (id,org_id,keyword,location,place_id,name,address,category,rating,review_count,rank,photo_url,authority_score,fetched_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
           ON CONFLICT (org_id,keyword,location,place_id) DO UPDATE SET name=EXCLUDED.name,address=EXCLUDED.address,category=EXCLUDED.category,rating=EXCLUDED.rating,review_count=EXCLUDED.review_count,rank=EXCLUDED.rank,photo_url=EXCLUDED.photo_url,authority_score=EXCLUDED.authority_score,fetched_at=NOW()`,
          [id, orgId, normalizedKeyword, normalizedLocation, placeId, item.name, item.address, item.category, item.rating, item.reviews, item.rank || idx + 1, item.photoUrl, authority],
        );
      }
    } finally { client.release(); }
    const persisted = await pool.query(
      `SELECT * FROM competitor_map_results WHERE org_id=$1 AND keyword=$2 AND location=$3 ORDER BY rank ASC NULLS LAST, review_count DESC`,
      [orgId, normalizedKeyword, normalizedLocation],
    );
    res.json({ ok: true, configured: true, competitors: persisted.rows, count: persisted.rows.length });
  } catch {
    res.status(502).json({ ok: false, configured: true, competitors: [], error: "La recherche locale est indisponible. Réessayez dans un instant." });
  }
});

router.post("/local-maps/competitors/:id/add", canWrite, async (req, res) => {
  const orgId = org(req);
  const client = await pool.connect();
  try {
    const found = await client.query(`SELECT * FROM competitor_map_results WHERE id=$1 AND org_id=$2 LIMIT 1`, [req.params.id, orgId]);
    const item = found.rows[0];
    if (!item) { res.status(404).json({ error: "Concurrent local introuvable." }); return; }
    const existing = await client.query(`SELECT id FROM competitors WHERE org_id=$1 AND name=$2 LIMIT 1`, [orgId, item.name]);
    if (existing.rows[0]) { res.json({ ok: true, alreadyExists: true, id: existing.rows[0].id }); return; }
    const id = `comp${Date.now()}`;
    const created = await client.query(
      `INSERT INTO competitors (id,name,url,domain_rating,keywords,traffic,threat_level,delta,org_id,created_at)
       VALUES ($1,$2,$3,$4,0,0,'medium',0,$5,NOW()) RETURNING *`,
      [id, item.name, String(item.address || item.name), Math.min(100, Number(item.authority_score) || 0), orgId],
    );
    res.status(201).json({ ok: true, competitor: created.rows[0] });
  } finally { client.release(); }
});

router.get("/local-maps/opportunities", async (req, res) => {
  const client = await pool.connect();
  try {
    const orgId = org(req);
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
