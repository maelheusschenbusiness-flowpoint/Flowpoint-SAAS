import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  getGoogleMapsResultsAtCoordinate,
  isDataForSEOConfigured,
  rembourserQuota,
  suivreAppelsPayants,
  verifierEtConsommerQuota,
} from "./dataforseo-service.js";
import {
  buildLocalGeoGrid,
  findBusinessRank,
  summarizeMeasuredCells,
  type MeasuredHeatmapCell,
} from "./local-heatmap-grid.js";

export interface Heatmap {
  id: string; org_id: string; name: string; keyword: string;
  location_id: string | null; center_lat: number; center_lng: number;
  radius_km: number; grid_size: number; status: string; created_at: string;
  business_name?: string; cells_data?: MeasuredHeatmapCell[]; summary?: ReturnType<typeof summarizeMeasuredCells>;
  dominance_score?: number | null; generated_at?: string | null; scan_error?: string | null;
}

type HeatmapResults = {
  businessName?: string;
  cells?: MeasuredHeatmapCell[];
  summary?: ReturnType<typeof summarizeMeasuredCells>;
  generatedAt?: string;
  error?: string;
};

function exposeHeatmap(row: Record<string, unknown>): Heatmap {
  let stored: HeatmapResults = {};
  try {
    const raw = row.results;
    stored = (typeof raw === "string" ? JSON.parse(raw) : raw) as HeatmapResults;
    if (!stored || Array.isArray(stored) || typeof stored !== "object") stored = {};
  } catch { stored = {}; }
  const cells = Array.isArray(stored.cells) ? stored.cells : [];
  const summary = stored.summary ?? summarizeMeasuredCells(cells);
  return {
    ...row,
    business_name: stored.businessName ?? "",
    cells_data: cells,
    summary,
    dominance_score: summary.dominanceScore,
    generated_at: stored.generatedAt ?? null,
    scan_error: stored.error ?? null,
  } as Heatmap;
}

export interface BusinessPoint {
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LocalCompetitorSummary {
  resultCount: number;
  uniqueCompetitors: number;
  searchContexts: number;
  top3Results: number;
  averageRating: number | null;
  averageReviews: number | null;
  bestCompetitorName: string | null;
  bestCompetitorRank: number | null;
}

const EMPTY_COMPETITOR_SUMMARY: LocalCompetitorSummary = {
  resultCount: 0,
  uniqueCompetitors: 0,
  searchContexts: 0,
  top3Results: 0,
  averageRating: null,
  averageReviews: null,
  bestCompetitorName: null,
  bestCompetitorRank: null,
};

export function summarizeLocalMaps(
  heatmaps: Heatmap[],
  competitors: LocalCompetitorSummary = EMPTY_COMPETITOR_SUMMARY,
) {
  const completedScans = heatmaps.filter(h => h.status === "completed").length;
  const allCells = heatmaps.flatMap(h => h.cells_data ?? []);
  const scanSummary = summarizeMeasuredCells(allCells);
  const scanInsight = scanSummary.measuredPoints
    ? `${scanSummary.measuredPoints}/${scanSummary.totalPoints} point(s) mesuré(s) ; ${scanSummary.notFoundPoints} point(s) sans établissement correspondant dans le top 20${scanSummary.averageRank == null ? "" : ` ; rang moyen observé #${scanSummary.averageRank}`}.`
    : "Les positions et la couverture de votre établissement ne sont pas mesurées dans les données disponibles.";
  return {
    summary: {
      totalHeatmaps: heatmaps.length,
      completedScans,
      avgRank: scanSummary.averageRank,
      top3GridPoints: scanSummary.top3Points,
      coverageScore: scanSummary.coverageScore,
      competitorsAnalyzed: competitors.resultCount,
      uniqueCompetitors: competitors.uniqueCompetitors,
      searchContexts: competitors.searchContexts,
      top3CompetitorResults: competitors.top3Results,
      averageCompetitorRating: competitors.averageRating,
      averageCompetitorReviews: competitors.averageReviews,
      bestCompetitorName: competitors.bestCompetitorName,
      bestCompetitorRank: competitors.bestCompetitorRank,
      localVisibilityScore: scanSummary.dominanceScore,
    },
    insights: [
      heatmaps.length
        ? `${heatmaps.length} carte(s) configurée(s), dont ${completedScans} analyse(s) marquée(s) terminée(s). ${scanInsight}`
        : "Aucune carte de suivi locale n’est enregistrée.",
      ...(competitors.resultCount
        ? [`${competitors.uniqueCompetitors} établissement(s) concurrent(s) distinct(s) relevé(s) sur ${competitors.searchContexts} recherche(s), avec ${competitors.top3Results} résultat(s) dans le top 3${competitors.averageRating == null ? "" : ` et une note moyenne de ${competitors.averageRating}/5`}${competitors.averageReviews == null ? "" : ` (${competitors.averageReviews} avis par établissement en moyenne)`}.`]
        : []),
    ],
  };
}

export function buildLocalMapsRecommendations(
  heatmaps: Heatmap[],
  competitors: LocalCompetitorSummary = EMPTY_COMPETITOR_SUMMARY,
) {
  const items: Array<{ title: string; description: string; impact: string; effort: string; priority: string }> = [];
  if (!heatmaps.length) {
    items.push({
      title: "Configurer une carte de suivi",
      description: "Enregistrez un mot-clé et une zone pour organiser le suivi. Cette configuration ne constitue pas une mesure de classement.",
      impact: "À mesurer", effort: "À estimer", priority: "medium",
    });
  } else {
    const pending = heatmaps.filter(map => map.status !== "completed").length;
    if (pending) items.push({
      title: "Vérifier les cartes en attente",
      description: `${pending} carte(s) n’ont pas de statut d’analyse terminé. Aucun classement ne peut être déduit de ces enregistrements.`,
      impact: "Non mesuré", effort: "À estimer", priority: "medium",
    });
  }
  if (competitors.resultCount) {
    items.push({
      title: "Comparer les concurrents les mieux classés",
      description: `${competitors.uniqueCompetitors} établissement(s) distinct(s) sur ${competitors.searchContexts} recherche(s). ${competitors.top3Results} résultat(s) sont dans le top 3${competitors.bestCompetitorName && competitors.bestCompetitorRank != null ? `; meilleur rang observé : ${competitors.bestCompetitorName} (#${competitors.bestCompetitorRank})` : ""}.`,
      impact: "À mesurer", effort: "À estimer", priority: "low",
    });
  } else if (heatmaps.length) {
    items.push({
      title: "Aucun résultat concurrent enregistré",
      description: "Aucun résultat concurrent n’est enregistré. Lancez une découverte locale pour comparer les établissements collectés ; aucun classement de votre établissement n’est déduit de ces données.",
      impact: "Non mesuré", effort: "À estimer", priority: "low",
    });
  }
  return items;
}

export interface MapsDashboard {
  heatmaps: Heatmap[];
  businessPoint: BusinessPoint | null;
  summary: {
    totalHeatmaps: number;
    completedScans: number;
    avgRank: number | null;
    top3GridPoints: number | null;
    coverageScore: number | null;
    competitorsAnalyzed: number | null;
    localVisibilityScore: number | null;
  };
  insights: string[];
  recommendations: Array<{ title: string; description: string; impact: string; effort: string; priority?: string }>;
}

// ── Server-side geocoding (Google, with explicit Nominatim opt-in fallback) ───
//
// Google Maps server calls have one canonical credential:
//   GOOGLE_MAPS_API_KEY
//
// Nominatim is deliberately not an implicit error-swallowing fallback. Enable
// it only when the operator explicitly sets ALLOW_NOMINATIM_FALLBACK=true.
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const googleKey = process.env["GOOGLE_MAPS_API_KEY"] ?? "";
  const allowNominatimFallback = process.env["ALLOW_NOMINATIM_FALLBACK"] === "true";

  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}&language=fr`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json() as { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } } }> };
        if (data.status === "OK" && data.results[0]) {
          const loc = data.results[0].geometry.location;
          return { lat: loc.lat, lng: loc.lng };
        }
        if (!allowNominatimFallback) {
          logger.warn({ googleStatus: data.status }, "[local-maps] Google geocoding rejected the request; Nominatim fallback is disabled");
          return null;
        }
      } else if (!allowNominatimFallback) {
        logger.warn({ status: r.status }, "[local-maps] Google geocoding HTTP failure; Nominatim fallback is disabled");
        return null;
      }
    } catch (err) {
      if (!allowNominatimFallback) {
        logger.warn({ err }, "[local-maps] Google geocoding failed; Nominatim fallback is disabled");
        return null;
      }
    }
  } else if (!allowNominatimFallback) {
    logger.warn("[local-maps] GOOGLE_MAPS_API_KEY is missing; Nominatim fallback is disabled");
    return null;
  }

  // Explicit fallback: Nominatim / OSM (no API key required).
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&accept-language=fr`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "FlowPoint/1.0 (contact@flowpoint.pro)" },
    });
    clearTimeout(timer);
    if (r.ok) {
      const data = await r.json() as Array<{ lat: string; lon: string }>;
      if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (err) {
    logger.warn({ err }, "[local-maps] Nominatim fallback failed");
  }

  return null;
}

// ── Load + enrich org business location ──────────────────────────────────────
// If lat/lng are absent but an address is stored, geocode and cache into org_settings.
async function getBusinessPoint(orgId: string): Promise<BusinessPoint | null> {
  const client = await pool.connect();
  try {
    // Load from org_settings (canonical location store)
    const r = await client.query(
      `SELECT address, city, latitude, longitude FROM org_settings WHERE org_id=$1 LIMIT 1`,
      [orgId],
    );
    const row = r.rows[0] as { address: string | null; city: string | null; latitude: string | number | null; longitude: string | number | null } | undefined;
    if (!row) return null;

    const address = row.address ?? null;
    const city    = row.city    ?? null;
    let lat  = row.latitude  != null ? Number(row.latitude)  : null;
    let lng  = row.longitude != null ? Number(row.longitude) : null;

    // If we have an address but no coords → geocode and persist
    const geoQuery = [address, city].filter(Boolean).join(", ");
    if (geoQuery && (lat == null || lng == null || isNaN(lat) || isNaN(lng))) {
      const coords = await geocodeAddress(geoQuery);
      if (coords) {
        lat = coords.lat;
        lng = coords.lng;
        // Cache back to org_settings so next load is instant
        await client.query(
          `UPDATE org_settings SET latitude=$1, longitude=$2 WHERE org_id=$3`,
          [lat, lng, orgId],
        ).catch(() => { /* non-fatal */ });
      }
    }

    if (!address && !city) return null;
    return {
      address,
      city,
      latitude:  lat  != null && !isNaN(lat)  ? lat  : null,
      longitude: lng  != null && !isNaN(lng)   ? lng  : null,
    };
  } catch {
    return null;
  } finally {
    client.release();
  }
}

export async function getMapsDashboard(orgId: string): Promise<MapsDashboard> {
  const [heatmaps, businessPoint, competitors] = await Promise.all([
    getHeatmaps(orgId),
    getBusinessPoint(orgId),
    getCompetitorSummary(orgId),
  ]);

  const measured = summarizeLocalMaps(heatmaps, competitors);

  return {
    heatmaps,
    businessPoint,
    summary: measured.summary,
    insights: measured.insights,
    recommendations: buildLocalMapsRecommendations(heatmaps, competitors),
  };
}

async function getCompetitorSummary(orgId: string): Promise<LocalCompetitorSummary> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS result_count,
       COUNT(DISTINCT place_id)::int AS unique_competitors,
       COUNT(DISTINCT (keyword, location))::int AS search_contexts,
       COUNT(*) FILTER (WHERE rank BETWEEN 1 AND 3)::int AS top3_results,
       ROUND(AVG(rating)::numeric, 1)::float8 AS average_rating,
       ROUND(AVG(review_count)::numeric, 0)::int AS average_reviews,
       (SELECT name FROM competitor_map_results
        WHERE org_id=$1
        ORDER BY rank ASC NULLS LAST, review_count DESC, fetched_at DESC
        LIMIT 1) AS best_competitor_name,
       (SELECT rank FROM competitor_map_results
        WHERE org_id=$1
        ORDER BY rank ASC NULLS LAST, review_count DESC, fetched_at DESC
        LIMIT 1) AS best_competitor_rank
     FROM competitor_map_results
     WHERE org_id=$1`,
    [orgId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    resultCount: Number(row?.["result_count"] ?? 0),
    uniqueCompetitors: Number(row?.["unique_competitors"] ?? 0),
    searchContexts: Number(row?.["search_contexts"] ?? 0),
    top3Results: Number(row?.["top3_results"] ?? 0),
    averageRating: row?.["average_rating"] == null ? null : Number(row["average_rating"]),
    averageReviews: row?.["average_reviews"] == null ? null : Number(row["average_reviews"]),
    bestCompetitorName: row?.["best_competitor_name"] == null ? null : String(row["best_competitor_name"]),
    bestCompetitorRank: row?.["best_competitor_rank"] == null ? null : Number(row["best_competitor_rank"]),
  };
}

export async function getHeatmaps(orgId: string): Promise<Heatmap[]> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE local_heatmaps
          SET status='failed',
              results=jsonb_set(
                CASE WHEN jsonb_typeof(results)='object' THEN results ELSE '{}'::jsonb END,
                '{error}', to_jsonb('Analyse interrompue après un redémarrage du serveur.'::text), true)
        WHERE org_id=$1 AND status='running'
          AND (results->>'startedAt')::timestamptz < NOW() - INTERVAL '15 minutes'`,
      [orgId],
    );
    const res = await client.query(
      `SELECT * FROM local_heatmaps WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [orgId]
    );
    return res.rows.map((row: Record<string, unknown>) => exposeHeatmap(row));
  } catch { return []; } finally { client.release(); }
}

export async function getHeatmapDetail(orgId: string, id: string): Promise<Heatmap | null> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE local_heatmaps
          SET status='failed',
              results=jsonb_set(
                CASE WHEN jsonb_typeof(results)='object' THEN results ELSE '{}'::jsonb END,
                '{error}', to_jsonb('Analyse interrompue après un redémarrage du serveur.'::text), true)
        WHERE id=$1 AND org_id=$2 AND status='running'
          AND (results->>'startedAt')::timestamptz < NOW() - INTERVAL '15 minutes'`,
      [id, orgId],
    );
    const res = await client.query(`SELECT * FROM local_heatmaps WHERE id=$1 AND org_id=$2 LIMIT 1`, [id, orgId]);
    return res.rows[0] ? exposeHeatmap(res.rows[0]) : null;
  } catch { return null; } finally { client.release(); }
}

export async function createHeatmap(orgId: string, data: {
  name: string; keyword: string; businessName: string; locationId?: string;
  centerLat: number; centerLng: number; radiusKm?: number; gridSize?: number;
}): Promise<Heatmap> {
  const client = await pool.connect();
  try {
    const id = `hm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO local_heatmaps
         (id, org_id, location_id, name, keyword, center_lat, center_lng, radius_km, grid_size, status, results, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10::jsonb,NOW())`,
      [id, orgId, data.locationId ?? null, data.name, data.keyword,
       data.centerLat, data.centerLng, data.radiusKm ?? 5, data.gridSize ?? 7,
       JSON.stringify({ businessName: data.businessName, cells: [] })]
    );
    const res = await client.query(`SELECT * FROM local_heatmaps WHERE id=$1`, [id]);
    return exposeHeatmap(res.rows[0]);
  } finally { client.release(); }
}

/** Claim a pending/failed scan once, then process it off the HTTP request path. */
export async function startHeatmapScan(orgId: string, id: string): Promise<boolean> {
  const claimed = await pool.query(
    `UPDATE local_heatmaps
        SET status='running',
            results=jsonb_set(
              CASE WHEN jsonb_typeof(results)='object' THEN results ELSE '{}'::jsonb END,
              '{startedAt}', to_jsonb(NOW()::text), true)
      WHERE id=$1 AND org_id=$2 AND status IN ('pending','failed')
      RETURNING *`,
    [id, orgId],
  );
  const row = claimed.rows[0] as Record<string, unknown> | undefined;
  if (!row) return false;
  void runHeatmapScan(orgId, row).catch(async error => {
    const errorMessage = error instanceof Error ? error.message : "Échec de l’analyse.";
    logger.error({ error: errorMessage, orgId, heatmapId: id }, "[local-maps] heatmap scan failed");
    await pool.query(
      `UPDATE local_heatmaps
          SET status='failed',
              results=jsonb_set(
                CASE WHEN jsonb_typeof(results)='object' THEN results ELSE '{}'::jsonb END,
                '{error}', to_jsonb($3::text), true)
        WHERE id=$1 AND org_id=$2 AND status='running'`,
      [id, orgId, errorMessage],
    ).catch(() => {});
  });
  return true;
}

async function runHeatmapScan(orgId: string, row: Record<string, unknown>): Promise<void> {
  const id = String(row.id);
  const businessName = String((row.results as HeatmapResults | undefined)?.businessName ?? "");
  const keyword = String(row.keyword ?? "");
  const gridSize = Number(row.grid_size);
  const points = buildLocalGeoGrid(
    Number(row.center_lat), Number(row.center_lng), Number(row.radius_km), gridSize,
  );
  if (!businessName.trim()) throw new Error("Le nom exact de l’établissement est requis.");
  if (!await isDataForSEOConfigured(orgId)) {
    await pool.query(
      `UPDATE local_heatmaps SET status='failed', results=$3::jsonb WHERE id=$1 AND org_id=$2`,
      [id, orgId, JSON.stringify({ businessName, cells: [], error: "DataForSEO n’est pas configuré." })],
    );
    return;
  }

  const quota = await verifierEtConsommerQuota(orgId, points.length);
  if (!quota.autorise) {
    if (quota.motif === "plafond") await rembourserQuota(orgId, points.length);
    await pool.query(
      `UPDATE local_heatmaps SET status='failed', results=$3::jsonb WHERE id=$1 AND org_id=$2`,
      [id, orgId, JSON.stringify({ businessName, cells: [], error: quota.motif === "plafond"
        ? "Le quota DataForSEO du jour ne permet pas cette grille."
        : "La vérification du quota est indisponible." })],
    );
    return;
  }

  const cells: MeasuredHeatmapCell[] = [];
  const { appelsReussis } = await suivreAppelsPayants(async () => {
    let next = 0;
    const workers = Array.from({ length: Math.min(4, points.length) }, async () => {
      while (next < points.length) {
        const point = points[next++]!;
        const lookup = await getGoogleMapsResultsAtCoordinate(
          keyword, point.latitude, point.longitude, orgId,
        );
        cells.push({
          ...point,
          status: lookup.error ? "error" : "measured",
          rank: lookup.error ? null : findBusinessRank(lookup.results, businessName),
        });
      }
    });
    await Promise.all(workers);
  });
  if (appelsReussis < points.length) await rembourserQuota(orgId, points.length - appelsReussis);

  cells.sort((a, b) => a.row - b.row || a.column - b.column);
  const summary = summarizeMeasuredCells(cells);
  const status = summary.measuredPoints === 0 ? "failed"
    : summary.measuredPoints < summary.totalPoints ? "partial" : "completed";
  const error = status === "partial"
    ? `${summary.totalPoints - summary.measuredPoints} point(s) n’ont pas pu être mesurés.`
    : status === "failed" ? "Aucun point de la grille n’a pu être mesuré." : undefined;
  await pool.query(
    `UPDATE local_heatmaps SET status=$3, results=$4::jsonb WHERE id=$1 AND org_id=$2`,
    [id, orgId, status, JSON.stringify({
      businessName, cells, summary, generatedAt: new Date().toISOString(), error,
    })],
  );
}

export async function generateAiLocalRecommendations(orgId: string): Promise<Array<{ title: string; description: string; impact: string; effort: string; priority: string }>> {
  const [heatmaps, competitors] = await Promise.all([
    getHeatmaps(orgId),
    getCompetitorSummary(orgId),
  ]);
  return buildLocalMapsRecommendations(heatmaps, competitors);
}
