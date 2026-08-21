import { Router, Request } from "express";
import { store } from "../services/store.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";
import { canWrite } from "../middlewares/requireRole.js";
import { requireQuota } from "../middlewares/planGate.js";
import { fetchCompetitorDomainMetrics } from "../services/dataforseo-service.js";
import { randomUUID } from "node:crypto";
import {
  runFullCompetitorAnalysis,
  getCompetitorAnalysis,
} from "../services/competitor-analysis-service.js";

const router = Router();

// ── In-memory suggestions cache: 6 h per org ─────────────────────────────────
const suggestionsCache = new Map<string, { ts: number; data: unknown[] }>();
const SUGGESTIONS_TTL_MS = 6 * 60 * 60 * 1000;

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;
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
    dataStatus:   row["data_status"] ?? "unavailable",
    dataFetchedAt: row["data_fetched_at"] ?? null,
    dataError:    row["data_error"] ?? null,
  };
}

function normalizeCompetitorUrl(value: string): { url: string; domain: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) return null;
    return { url: `https://${parsed.hostname.toLowerCase()}`, domain: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

async function enrichCompetitor(
  req: OrgReq,
  id: string,
  domain: string,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const metrics = await fetchCompetitorDomainMetrics(domain, orgId);
  if (metrics.ok) {
    const update = await req.orgDb(
      `UPDATE competitors
       SET domain_rating=$1, keywords=$2, traffic=$3, data_status='available',
           data_provider=$4, provider_model=$5, data_fetched_at=NOW(), data_error=NULL
       WHERE id=$6 AND org_id=$7
       RETURNING *`,
      [metrics.authority, metrics.keywords, metrics.traffic, metrics.provider, metrics.providerModel, id, orgId],
    );
    return update.rows[0] ?? null;
  }

  const message: Record<typeof metrics.reason, string> = {
    // This is customer-facing copy: a third-party data supplier is platform
    // infrastructure, never something the customer needs to configure.
    not_configured: "Les métriques de ce concurrent ne sont pas encore disponibles.",
    no_metrics: "Aucune métrique n’est disponible pour ce domaine pour le moment.",
    provider_error: "Les métriques sont temporairement indisponibles. Réessayez plus tard.",
  };
  const update = await req.orgDb(
    `UPDATE competitors
     SET data_status='unavailable', data_provider=$1, provider_model=NULL,
         data_fetched_at=NOW(), data_error=$2
     WHERE id=$3 AND org_id=$4
     RETURNING *`,
    [metrics.provider, message[metrics.reason], id, orgId],
  );
  return update.rows[0] ?? null;
}

// ── GET /competitors ──────────────────────────────────────────────────────────
// req.orgDb scopes via RLS → only this org's competitors are returned.

router.get("/competitors", async (req, res) => {
  try {
    const orgId = (req as import("express").Request & { orgId?: string }).orgId ?? req.orgContext?.orgId ?? "default";
    const result = await req.orgDb(
      `SELECT * FROM competitors WHERE org_id=$1 ORDER BY data_status='available' DESC, domain_rating DESC LIMIT 200`,
      [orgId],
    );
    res.json(result.rows.map(toPublic));
  } catch (err) {
    logger.warn({ err }, "[competitors] GET failed");
    res.status(500).json({ error: "Failed to fetch competitors" });
  }
});

// ── GET /competitors/:id ──────────────────────────────────────────────────────

router.get("/competitors/:id", async (req, res) => {
  try {
    const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";
    const result = await req.orgDb(`SELECT * FROM competitors WHERE id = $1 AND org_id = $2 LIMIT 1`, [req.params.id, orgId]);
    if (!result.rows[0]) { res.status(404).json({ error: "Competitor not found" }); return; }
    res.json(toPublic(result.rows[0]));
  } catch (err) {
    logger.warn({ err }, "[competitors] GET :id failed");
    res.status(500).json({ error: "Failed to fetch competitor" });
  }
});

// ── POST /competitors ─────────────────────────────────────────────────────────

router.post(
  "/competitors",
  reportRateLimit,
  canWrite,
  requireQuota("competitors", async (orgId, quotaReq) => {
    const result = await (quotaReq as OrgReq).orgDb(
      `SELECT COUNT(*)::int AS count FROM competitors WHERE org_id = $1`,
      [orgId],
    );
    return Number(result.rows[0]?.["count"] ?? 0);
  }),
  async (req, res) => {
    const { name: rawName, url: rawUrl, domain: rawDomain, threatLevel = "low" } = req.body as {
      name?: string; url?: string; domain?: string; threatLevel?: string;
    };
    const name = rawName?.trim();
    const target = normalizeCompetitorUrl(rawUrl || rawDomain || "");
    if (!name || !target) {
      res.status(400).json({ error: "A name and public http(s) domain are required" });
      return;
    }
    const threat = ["critical", "high", "medium", "low"].includes(threatLevel) ? threatLevel : "low";
    const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";

    try {
      const id = `comp_${randomUUID()}`;
      const created = await (req as OrgReq).orgDb(
        `INSERT INTO competitors (
          id, name, url, domain_rating, keywords, traffic, threat_level, delta, org_id,
          data_status, data_provider, created_at
        ) VALUES ($1,$2,$3,0,0,0,$4,0,$5,'pending','DataForSEO',NOW())
        RETURNING *`,
        [id, name, target.url, threat, orgId],
      );
      const enriched = await enrichCompetitor(req as OrgReq, id, target.domain, orgId);
      const competitor = enriched ?? created.rows[0];
      store.logActivity({
        type: "alert", label: `Concurrent ajouté : ${name}`,
        targetId: id, targetType: "competitor",
        orgId,
      }).catch(() => {});
      res.status(201).json(toPublic(competitor));
    } catch (err) {
      logger.error({ err }, "[competitors] POST failed");
      res.status(500).json({ error: "Failed to create competitor" });
    }
  },
);

// ── POST /competitors/:id/refresh ────────────────────────────────────────────
// The row remains visible if the provider cannot respond; only its persisted
// data status changes so the UI can offer another retry without fake metrics.
router.post("/competitors/:id/refresh", reportRateLimit, canWrite, async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";
  try {
    const existing = await (req as OrgReq).orgDb(
      `SELECT * FROM competitors WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [req.params.id, orgId],
    );
    const row = existing.rows[0];
    if (!row) { res.status(404).json({ error: "Competitor not found" }); return; }
    const target = normalizeCompetitorUrl(String(row["url"] ?? ""));
    if (!target) {
      res.status(400).json({ error: "Saved competitor domain is invalid" });
      return;
    }
    const refreshed = await enrichCompetitor(req as OrgReq, String(row["id"]), target.domain, orgId);
    res.json(toPublic(refreshed ?? row));
  } catch (err) {
    logger.error({ err }, "[competitors] refresh failed");
    res.status(500).json({ error: "Failed to refresh competitor data" });
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
    const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";
    const result = await req.orgDb(
      `UPDATE competitors SET ${setClauses.join(", ")} WHERE id = $1 AND org_id = $${values.length + 2} RETURNING *`,
      [id, ...values, orgId],
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
    const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";
    const r = await req.orgDb(`DELETE FROM competitors WHERE id = $1 AND org_id = $2 RETURNING id`, [req.params.id, orgId]);
    if (!r.rows[0]) { res.status(404).json({ error: "Competitor not found" }); return; }
    // Also remove analysis so next add starts fresh
    req.orgDb(`DELETE FROM competitor_analysis WHERE competitor_id=$1 AND org_id=$2`, [req.params.id, orgId]).catch(() => {});
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to delete competitor" }); }
});

// ── GET /competitors/:id/analysis ────────────────────────────────────────────
// Returns the stored AI analysis for a competitor (fast, reads DB only).

router.get("/competitors/:id/analysis", async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";
  try {
    const analysis = await getCompetitorAnalysis(req.params.id, orgId, (sql, vals) => req.orgDb(sql, vals));
    if (!analysis) {
      res.status(404).json({ ok: false, error: "no_analysis", message: "Aucune analyse disponible — lancez une analyse depuis la page Concurrents." });
      return;
    }
    res.json({ ok: true, analysis });
  } catch (err) {
    logger.warn({ err }, "[competitors] GET analysis failed");
    res.status(500).json({ ok: false, error: "Failed to fetch analysis" });
  }
});

// ── POST /competitors/:id/analyze ─────────────────────────────────────────────
// Full pipeline: scrape public site + optional SEO metrics + AI analysis → DB.
// DataForSEO is additive only — its failure never blocks the AI analysis.

router.post("/competitors/:id/analyze", reportRateLimit, canWrite, async (req, res) => {
  const orgId = (req as OrgReq).orgId ?? req.orgContext?.orgId ?? "default";
  try {
    // 1. Fetch competitor row
    const existing = await req.orgDb(
      `SELECT * FROM competitors WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [req.params.id, orgId],
    );
    const row = existing.rows[0];
    if (!row) { res.status(404).json({ ok: false, error: "Competitor not found" }); return; }

    const normalizedUrl = normalizeCompetitorUrl(String(row["url"] ?? ""));
    if (!normalizedUrl) {
      res.status(400).json({ ok: false, error: "L'URL du concurrent est invalide" }); return;
    }
    const competitorUrl = normalizedUrl.url;

    // 2. Collect org context (best-effort, non-blocking)
    let orgContext: {
      orgName?: string; orgUrl?: string; orgPlan?: string;
      orgKeywords?: string[]; orgScore?: number; orgFeatures?: string[];
    } = {};
    try {
      const [kwRes, auditRes, prefRes] = await Promise.allSettled([
        req.orgDb(`SELECT keyword FROM tracked_keywords WHERE org_id=$1 AND active=true LIMIT 20`, [orgId]),
        req.orgDb(`SELECT score FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [orgId]),
        req.orgDb(`SELECT settings FROM user_prefs WHERE org_id=$1 LIMIT 1`, [orgId]),
      ]);
      if (kwRes.status === "fulfilled") {
        orgContext.orgKeywords = (kwRes.value.rows as Record<string, unknown>[]).map(r => String(r["keyword"] ?? "")).filter(Boolean);
      }
      if (auditRes.status === "fulfilled" && (auditRes.value.rows as Record<string, unknown>[])[0]) {
        orgContext.orgScore = Number((auditRes.value.rows as Record<string, unknown>[])[0]?.["score"] ?? 0);
      }
      if (prefRes.status === "fulfilled" && (prefRes.value.rows as Record<string, unknown>[])[0]) {
        const settings = ((prefRes.value.rows as Record<string, unknown>[])[0]?.["settings"] as Record<string, unknown>) ?? {};
        orgContext.orgName = String(settings["companyName"] ?? settings["orgName"] ?? "");
        orgContext.orgUrl  = String(settings["siteUrl"] ?? settings["websiteUrl"] ?? "");
        orgContext.orgPlan = String(settings["plan"] ?? "");
      }
    } catch { /* non-fatal */ }

    // 3. Run full analysis pipeline
    const result = await runFullCompetitorAnalysis({
      competitorId:   String(row["id"]),
      competitorName: String(row["name"] ?? "Concurrent"),
      competitorUrl,
      orgId,
      userId:  req.userId ?? "system",
      orgDb:   (sql, vals) => req.orgDb(sql, vals),
      orgContext,
    });

    if (!result.ok) {
      res.status(422).json({ ok: false, error: result.error });
      return;
    }

    // 4. Log activity
    store.logActivity({
      type: "report",
      label: `Analyse IA lancée sur le concurrent : ${String(row["name"])}`,
      targetId: String(row["id"]), targetType: "competitor",
      orgId,
    }).catch(() => {});

    res.json({ ok: true, analysis: result.analysis });
  } catch (err) {
    logger.error({ err }, "[competitors] POST analyze failed");
    res.status(500).json({ ok: false, error: "Erreur lors de l'analyse — réessayez dans quelques instants" });
  }
});

export default router;
