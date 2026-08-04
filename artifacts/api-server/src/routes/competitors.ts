import { Router, Request } from "express";
import { store } from "../services/store.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";
import { canWrite } from "../middlewares/requireRole.js";
import { withCache } from "../middlewares/cacheControl.js";

const router = Router();

// ── In-memory suggestions cache: 6 h per org ─────────────────────────────────
const suggestionsCache = new Map<string, { ts: number; data: unknown[] }>();
const SUGGESTIONS_TTL_MS = 6 * 60 * 60 * 1000;

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};

function scoreThreat(place: Record<string, unknown>, orgKeywords: string[]): "high" | "medium" | "low" {
  const rating  = typeof place["rating"]             === "number" ? place["rating"]             : 0;
  const reviews = typeof place["user_ratings_total"] === "number" ? place["user_ratings_total"] : 0;
  const types   = ((place["types"] as string[]) ?? []).join(" ").toLowerCase();
  const name    = String(place["name"] ?? "").toLowerCase();
  const match   = orgKeywords.some(k => name.includes(k.toLowerCase()) || types.includes(k.toLowerCase()));
  const score   = (rating  >= 4.5 ? 3 : rating  >= 4.0 ? 2 : 1)
                + (reviews >= 500 ? 3 : reviews >= 100  ? 2 : reviews >= 20 ? 1 : 0)
                + (match ? 2 : 0);
  return score >= 6 ? "high" : score >= 3 ? "medium" : "low";
}

function threatReason(place: Record<string, unknown>, threat: string): string {
  const rating  = typeof place["rating"]             === "number" ? place["rating"]             : null;
  const reviews = typeof place["user_ratings_total"] === "number" ? place["user_ratings_total"] : 0;
  if (threat === "high")   return `Note ${rating ?? "?"}/5 avec ${reviews} avis — concurrent direct très actif`;
  if (threat === "medium") return `Note ${rating ?? "?"}/5 avec ${reviews} avis — présence locale établie`;
  return `Faible présence (${reviews} avis) — concurrent potentiel à surveiller`;
}

// ── GET /competitors/suggestions ─────────────────────────────────────────────
router.get("/competitors/suggestions", async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";

  const cached = suggestionsCache.get(orgId);
  if (cached && Date.now() - cached.ts < SUGGESTIONS_TTL_MS) {
    res.json({ ok: true, suggestions: cached.data, cached: true });
    return;
  }

  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) {
    res.json({ ok: true, suggestions: [], reason: "maps_not_configured" });
    return;
  }

  try {
    // 1. Resolve org GBP lat/lng
    let lat: number | null = null;
    let lng: number | null = null;
    let locationAddress: string | null = null;
    try {
      const locRes = await (req as OrgReq).orgDb(
        `SELECT lat, lng, raw_data FROM google_locations WHERE org_id=$1 ORDER BY last_sync_at DESC LIMIT 1`,
        [orgId]
      );
      const locRow = locRes.rows[0];
      if (locRow) {
        lat = typeof locRow["lat"] === "number" ? locRow["lat"] : null;
        lng = typeof locRow["lng"] === "number" ? locRow["lng"] : null;
        if (lat == null || lng == null) {
          const raw = locRow["raw_data"] as Record<string, unknown> | null;
          const latlng = raw?.["latlng"] as Record<string, unknown> | null;
          if (latlng) {
            lat = typeof latlng["latitude"]  === "number" ? latlng["latitude"]  : null;
            lng = typeof latlng["longitude"] === "number" ? latlng["longitude"] : null;
          }
          if (lat == null) {
            const addr = raw?.["storefrontAddress"] as Record<string, unknown> | null;
            if (addr) {
              const lines = (addr["addressLines"] as string[] | undefined) ?? [];
              locationAddress = [...lines, addr["locality"], addr["administrativeArea"]].filter(Boolean).join(", ");
            }
          }
        }
      }
    } catch { /* no GBP data */ }

    if (lat == null && !locationAddress) {
      res.json({ ok: true, suggestions: [], reason: "no_gbp_location" });
      return;
    }

    // Geocode from address if lat/lng not stored
    if ((lat == null || lng == null) && locationAddress) {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationAddress)}&key=${apiKey}`;
      const geoData = await fetch(geoUrl).then(r => r.json()) as Record<string, unknown>;
      const results = (geoData["results"] as unknown[]) ?? [];
      if (results.length > 0) {
        const loc = ((results[0] as Record<string, unknown>)["geometry"] as Record<string, unknown>)?.["location"] as Record<string, number> | undefined;
        lat = loc?.["lat"] ?? null;
        lng = loc?.["lng"] ?? null;
      }
    }

    if (lat == null || lng == null) {
      res.json({ ok: true, suggestions: [], reason: "no_gbp_location" });
      return;
    }

    // 2. Org tracked keywords
    let orgKeywords: string[] = [];
    try {
      const kwRes = await (req as OrgReq).orgDb(
        `SELECT keyword FROM tracked_keywords WHERE org_id=$1 AND active=true LIMIT 20`,
        [orgId]
      );
      orgKeywords = kwRes.rows.map((r: Record<string, unknown>) => String(r["keyword"] ?? "")).filter(Boolean);
    } catch { /* non-fatal */ }

    // 3. Nearby Places search
    const searchKeyword = orgKeywords[0] ?? "business";
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=3000&keyword=${encodeURIComponent(searchKeyword)}&key=${apiKey}`;
    const nearbyData = await fetch(nearbyUrl).then(r => r.json()) as Record<string, unknown>;
    const places = (nearbyData["results"] as Record<string, unknown>[]) ?? [];

    // 4. Score and shape
    const suggestions = places.slice(0, 20).map(place => {
      const threat = scoreThreat(place, orgKeywords);
      const geom   = (place["geometry"] as Record<string, unknown>)?.["location"] as Record<string, number> | undefined;
      return {
        name:             String(place["name"] ?? ""),
        address:          String(place["vicinity"] ?? place["formatted_address"] ?? ""),
        lat:              geom?.["lat"] ?? null,
        lng:              geom?.["lng"] ?? null,
        rating:           typeof place["rating"]             === "number" ? place["rating"]             : null,
        userRatingsTotal: typeof place["user_ratings_total"] === "number" ? place["user_ratings_total"] : 0,
        placeId:          String(place["place_id"] ?? ""),
        threat,
        reason: threatReason(place, threat),
      };
    });
    suggestions.sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const d = (order[a.threat] ?? 2) - (order[b.threat] ?? 2);
      return d !== 0 ? d : (b.userRatingsTotal ?? 0) - (a.userRatingsTotal ?? 0);
    });

    suggestionsCache.set(orgId, { ts: Date.now(), data: suggestions });
    res.json({ ok: true, suggestions });
  } catch (err) {
    logger.warn({ err }, "[competitors/suggestions] failed");
    res.json({ ok: true, suggestions: [], reason: "fetch_error" });
  }
});

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

router.post("/competitors", reportRateLimit, canWrite, async (req, res) => {
  const {
    name, url: rawUrl, domain: rawDomain,
    domainRating = 0, keywords = 0, traffic = 0, threatLevel = "low",
  } = req.body as {
    name?: string; url?: string; domain?: string; domainRating?: number;
    keywords?: number; traffic?: number; threatLevel?: string;
  };
  const url = rawUrl || rawDomain; // accept 'domain' as alias for 'url'
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
      orgId,
    }).catch(() => {});
    res.status(201).json(toPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[competitors] POST failed");
    res.status(500).json({ error: "Failed to create competitor" });
  }
});

// ── PATCH /competitors/:id ────────────────────────────────────────────────────

router.patch("/competitors/:id", canWrite, async (req, res) => {
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

router.delete("/competitors/:id", canWrite, async (req, res) => {
  try {
    const r = await req.orgDb(`DELETE FROM competitors WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) { res.status(404).json({ error: "Competitor not found" }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to delete competitor" }); }
});

export default router;
