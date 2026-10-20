import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface Heatmap {
  id: string; org_id: string; name: string; keyword: string;
  location_id: string | null; center_lat: number; center_lng: number;
  radius_km: number; grid_size: number; status: string; created_at: string;
}

export interface BusinessPoint {
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface MapsDashboard {
  heatmaps: Heatmap[];
  businessPoint: BusinessPoint | null;
  summary: {
    totalHeatmaps: number;
    avgRank: number | null;
    top3GridPoints: number | null;
    coverageScore: number | null;
    competitorsAnalyzed: number | null;
    localVisibilityScore: number | null;
  };
  insights: string[];
  recommendations: Array<{ title: string; description: string; impact: string; effort: string }>;
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
  const [heatmaps, businessPoint] = await Promise.all([
    getHeatmaps(orgId),
    getBusinessPoint(orgId),
  ]);

  type HeatmapExt = Heatmap & { dominance_score?: unknown };
  const dominanceScores = heatmaps.map(h => Number((h as HeatmapExt).dominance_score ?? 0)).filter(n => n > 0);
  const avgRank = dominanceScores.length > 0
    ? Math.round((dominanceScores.reduce((s, n) => s + n, 0) / dominanceScores.length) * 10) / 10
    : null;
  const coverageScore = heatmaps.length > 0
    ? Math.min(100, Math.round((heatmaps.filter(h => Number((h as HeatmapExt).dominance_score ?? 0) >= 50).length / heatmaps.length) * 100))
    : null;

  return {
    heatmaps,
    businessPoint,
    summary: {
      totalHeatmaps: heatmaps.length,
      avgRank,
      top3GridPoints: null,
      coverageScore,
      competitorsAnalyzed: null,
      localVisibilityScore: null,
    },
    insights: [],
    recommendations: [],
  };
}

export async function getHeatmaps(orgId: string): Promise<Heatmap[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM local_heatmaps WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [orgId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getHeatmapDetail(orgId: string, id: string): Promise<Heatmap | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM local_heatmaps WHERE id=$1 AND org_id=$2 LIMIT 1`, [id, orgId]);
    return res.rows[0] ?? null;
  } catch { return null; } finally { client.release(); }
}

export async function createHeatmap(orgId: string, data: {
  name: string; keyword: string; locationId?: string;
  centerLat: number; centerLng: number; radiusKm?: number; gridSize?: number;
}): Promise<Heatmap> {
  const client = await pool.connect();
  try {
    const id = `hm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO local_heatmaps
         (id, org_id, location_id, name, keyword, center_lat, center_lng, radius_km, grid_size, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NOW())`,
      [id, orgId, data.locationId ?? null, data.name, data.keyword,
       data.centerLat, data.centerLng, data.radiusKm ?? 5, data.gridSize ?? 7]
    );
    const res = await client.query(`SELECT * FROM local_heatmaps WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function generateAiLocalRecommendations(_orgId: string): Promise<Array<{ title: string; description: string; priority: string }>> {
  return [
    { title: "Créer des citations locales", description: "Inscrivez votre entreprise sur les 10 annuaires locaux les plus importants de votre secteur.", priority: "high" },
    { title: "Optimiser les photos Google Business", description: "Les fiches avec 10+ photos reçoivent 35% plus de clics. Ajoutez des photos récentes de qualité.", priority: "high" },
    { title: "Répondre aux questions publiques", description: "Répondre aux questions Q&A sur votre fiche GBP améliore la confiance et le référencement local.", priority: "medium" },
  ];
}
