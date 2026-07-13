import { Router, Request } from "express";
import { store } from "../services/store.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";
import { withCache } from "../middlewares/cacheControl.js";

const router = Router();

// ── DB row → public shape ──────────────────────────────────────────────────────
function toPublic(row: Record<string, unknown>) {
  return {
    id:           row["id"],
    name:         row["name"],
    url:          row["url"],
    domainRating: row["domain_rating"],
    keywords:     row["keywords"],
    traffic:      row["traffic"],
    threatLevel:  row["threat_level"],
    delta:        row["delta"],
    createdAt:    row["created_at"],
  };
}

// ── GET /competitors ──────────────────────────────────────────────────────────
// req.orgDb scopes via RLS → only this org's competitors are returned.

router.get("/competitors", withCache(60), async (req, res) => {
  try {
    const orgId = (req as import("express").Request & { orgId?: string }).orgId ?? req.orgContext?.orgId ?? "default";
    const result = await req.orgDb(
      `SELECT * FROM competitors WHERE org_id=$1 ORDER BY domain_rating DESC LIMIT 200`,
      [orgId],
    );
    res.json(result.rows.map(toPublic));
  } catch (err) {
    logger.warn({ err }, "[competitors] GET failed");
    res.json([]);
  }
});

// ── GET /competitors/:id ──────────────────────────────────────────────────────

router.get("/competitors/:id", async (req, res) => {
  try {
    const result = await req.orgDb(`SELECT * FROM competitors WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!result.rows[0]) { res.status(404).json({ error: "Competitor not found" }); return; }
    res.json(toPublic(result.rows[0]));
  } catch (err) {
    logger.warn({ err }, "[competitors] GET :id failed");
    res.status(500).json({ error: "Failed to fetch competitor" });
  }
});

// ── POST /competitors ─────────────────────────────────────────────────────────

router.post("/competitors", reportRateLimit, async (req, res) => {
  const {
    name, url,
    domainRating = 0, keywords = 0, traffic = 0, threatLevel = "low",
  } = req.body as {
    name?: string; url?: string; domainRating?: number;
    keywords?: number; traffic?: number; threatLevel?: string;
  };
  if (!name || !url) { res.status(400).json({ error: "name and url required" }); return; }

  const orgId = (req as Request & { orgId?: string }).orgId ?? "default";

  try {
    const id     = `comp${Date.now()}`;
    const result = await req.orgDb(
      `INSERT INTO competitors (id, name, url, domain_rating, keywords, traffic, threat_level, delta, org_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,NOW()) RETURNING *`,
      [id, name, url, Number(domainRating), Number(keywords), Number(traffic), threatLevel || "low", orgId],
    );
    store.logActivity({
      type: "alert", label: `Concurrent ajouté : ${name}`,
      targetId: id, targetType: "competitor",
    }).catch(() => {});
    res.status(201).json(toPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[competitors] POST failed");
    res.status(500).json({ error: "Failed to create competitor" });
  }
});

// ── PATCH /competitors/:id ────────────────────────────────────────────────────

router.patch("/competitors/:id", async (req, res) => {
  const { id } = req.params;
  const body = req.body as {
    name?: string; url?: string; domainRating?: number;
    keywords?: number; traffic?: number; threatLevel?: string; delta?: number;
  };

  const values: unknown[]    = [];
  const setClauses: string[] = [];

  function addField(col: string, val: unknown): void {
    values.push(val);
    setClauses.push(`${col} = $${values.length + 1}`);
  }

  if (body.name         !== undefined) addField("name",          body.name);
  if (body.url          !== undefined) addField("url",           body.url);
  if (body.domainRating !== undefined) addField("domain_rating", Number(body.domainRating));
  if (body.keywords     !== undefined) addField("keywords",      Number(body.keywords));
  if (body.traffic      !== undefined) addField("traffic",       Number(body.traffic));
  if (body.threatLevel  !== undefined) addField("threat_level",  body.threatLevel);
  if (body.delta        !== undefined) addField("delta",         Number(body.delta));

  if (setClauses.length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }

  try {
    const result = await req.orgDb(
      `UPDATE competitors SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (!result.rowCount) { res.status(404).json({ error: "not found" }); return; }
    res.json(toPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[competitors] PATCH failed");
    res.status(500).json({ error: "Update failed" });
  }
});

// ── DELETE /competitors/:id ───────────────────────────────────────────────────
// RLS ensures cross-org deletes are silently blocked.

router.delete("/competitors/:id", async (req, res) => {
  try {
    await req.orgDb(`DELETE FROM competitors WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

export default router;
