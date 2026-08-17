/** Server-side Maps API key — prefers FLOWPOINT_MAP_BACKEND (Places-enabled), falls back to GOOGLE_MAPS_API_KEY */
function getMapsApiKey(): string {
  return process.env["FLOWPOINT_MAP_BACKEND"] ?? process.env["GOOGLE_MAPS_API_KEY"] ?? "";
}

export function isMapsConfigured(): boolean {
  return !!getMapsApiKey();
}

export async function geocodeAddress(address: string): Promise<{
  lat: number; lng: number; formattedAddress: string; placeId: string;
} | null> {
  const apiKey = getMapsApiKey();
  if (!apiKey) throw new Error("Google Maps API key not configured");

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json() as Record<string, unknown>;
  const results = (data["results"] as unknown[]) ?? [];
  if (!results.length) return null;
  const first = results[0] as Record<string, unknown>;
  const loc = (first["geometry"] as Record<string, unknown>)?.["location"] as Record<string, number>;
  return {
    lat: loc.lat, lng: loc.lng,
    formattedAddress: String(first["formatted_address"] ?? address),
    placeId: String(first["place_id"] ?? ""),
  };
}

/**
 * Fetches nearby places from Google Places Nearby Search, automatically
 * paginating through up to 3 pages (≤60 results) using next_page_token.
 * Google requires a ~2 s delay before requesting each subsequent page.
 */
export async function getNearbyPlaces(lat: number, lng: number, type: string, radius = 5000, keyword = ""): Promise<unknown[]> {
  const apiKey = getMapsApiKey();
  if (!apiKey) throw new Error("Google Maps API key not configured");
  const kw = keyword.trim() ? `&keyword=${encodeURIComponent(keyword.trim())}` : "";

  const allResults: unknown[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < 3; page++) {
    let url: string;
    if (pageToken) {
      // Pages 2 and 3: only pagetoken + key are sent (other params are encoded in the token)
      url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${encodeURIComponent(pageToken)}&key=${apiKey}`;
    } else {
      url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}${kw}&key=${apiKey}`;
    }

    const res = await fetch(url);
    const data = await res.json() as Record<string, unknown>;
    const pageResults = (data["results"] as unknown[]) ?? [];
    allResults.push(...pageResults);

    pageToken = (data["next_page_token"] as string | undefined) ?? null;
    if (!pageToken) break;

    // Google mandates a short delay before the next_page_token becomes valid
    await new Promise<void>((r) => setTimeout(r, 2000));
  }

  return allResults;
}

export async function getDistanceMatrix(origins: string[], destinations: string[]): Promise<unknown> {
  const apiKey = getMapsApiKey();
  if (!apiKey) throw new Error("Google Maps API key not configured");
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins.join("|")}&destinations=${destinations.join("|")}&key=${apiKey}`;
  const res = await fetch(url);
  return res.json();
}

/**
 * Returns a grid of geo-points around the given location.
 * rank is always null here — it must be populated by a DataForSEO sync job
 * (see local-maps-service.ts) stored in the heatmap_data table.
 * Returning null prevents fabricated rank numbers from misleading users.
 */
export async function getHeatmapData(lat: number, lng: number, radius = 5000, keyword = "", gridSize = 9): Promise<Array<{ lat: number; lng: number; rank: number | null }>> {
  void keyword; // reserved for DataForSEO batch job
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  // Grid spans the requested radius around the given coordinates.
  // ~111km per degree of latitude; longitude degrees shrink with cos(lat).
  const half = Math.floor(gridSize / 2);
  const latStep = half > 0 ? (radius / 111_000) / half : 0;
  const lngStep = half > 0 ? (radius / (111_000 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))) / half : 0;
  const points: Array<{ lat: number; lng: number; rank: number | null }> = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      points.push({ lat: lat + i * latStep, lng: lng + j * lngStep, rank: null });
    }
  }
  return points;
}

/** Haversine distance in meters between two coordinates. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/**
 * Returns nearby competitors in the flat shape the frontend map expects:
 * { placeId, name, vicinity, lat, lng, rating, reviewCount, distanceM, seoScore, threatLevel }.
 *
 * The previous version returned raw Google Nearby Search results
 * (geometry.location nesting) which made every marker fail with
 * "InvalidValueError: setPosition: in property lat: not a number".
 *
 * seoScore is a local-visibility heuristic DERIVED from real Google data
 * (rating + review volume), never random: rating drives up to 60 pts,
 * review count (log scale) up to 40 pts. Places without coordinates are
 * dropped instead of producing NaN markers.
 */
/**
 * Full-disk competitor search covering up to 100 km using a 7-point hexagonal
 * grid (centre + 6 surrounding points at ring_radius = R × √3/2).
 *
 * Proof of complete coverage
 * ──────────────────────────
 * For a disk of radius R covered by circles of radius r = 50 km, the ring
 * radius is chosen such that the worst-case point (on the R perimeter, 30°
 * from the nearest ring point) is exactly r from that ring point:
 *   ring = R × √3/2  →  d² = ring² + R² − 2·ring·R·cos30° = R²·(3/4 + 1 − 3/2) = 0 ≠ r²
 * Wait — actual derivation: ring = R × √3/2, cos30° = √3/2:
 *   d² = (R√3/2)² + R² − 2·(R√3/2)·R·(√3/2)
 *      = 3R²/4 + R² − 3R²/2 = 4R²/4 − 6R²/4 + 3R²/4 = R²/4  →  d = R/2 = 50 km when R=100 km ✓
 * The 6-fold symmetry (60° steps) means every point inside the disk is within
 * 50 km of at least one of the 7 centres — no gaps anywhere, including diagonals.
 */
export async function analyzeCompetitors(lat: number, lng: number, keyword: string, radius = 5000): Promise<unknown[]> {
  const SEARCH_RADIUS = 50000; // Google Places API hard limit per request
  const EFF_RADIUS = Math.min(100000, radius);

  // ring_radius = EFF_RADIUS × √3/2 guarantees every point in the disk
  // is within SEARCH_RADIUS of at least one of the 7 hexagonal centres.
  const cosLat = Math.max(0.3, Math.cos(lat * Math.PI / 180));
  const centres: Array<{ lat: number; lng: number }> = [{ lat, lng }];

  if (EFF_RADIUS > 50000) {
    // >50 km  — 7-point hexagonal grid (centre + 6 ring points at √3/2·R)
    const RING_M = EFF_RADIUS * Math.sqrt(3) / 2;
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3; // 0°, 60°, 120°, 180°, 240°, 300°
      centres.push({
        lat: lat + (RING_M / 111_000) * Math.sin(ang),
        lng: lng + (RING_M / (111_000 * cosLat)) * Math.cos(ang),
      });
    }
  } else if (EFF_RADIUS > 15000) {
    // 15–50 km — 4-point grid (centre + 3 surrounding at 120° for triangular coverage)
    // Ring at 60% of EFF_RADIUS gives comfortable overlap between search circles.
    const RING_M = EFF_RADIUS * 0.6;
    for (let i = 0; i < 3; i++) {
      const ang = (i * 2 * Math.PI) / 3; // 0°, 120°, 240°
      centres.push({
        lat: lat + (RING_M / 111_000) * Math.sin(ang),
        lng: lng + (RING_M / (111_000 * cosLat)) * Math.cos(ang),
      });
    }
  }
  // ≤15 km — single centre; pagination inside getNearbyPlaces gives ≤60 results

  // Each centre uses the actual requested radius (capped to 50 km per Google limit)
  const SEARCH_RADIUS_PER_CENTRE = Math.min(50000, EFF_RADIUS);

  const seen = new Map<string, Record<string, unknown>>();
  // Centres run in parallel; pagination inside getNearbyPlaces is sequential per centre
  // (with the mandatory 2 s inter-page delay). This keeps total latency bounded by
  // the slowest centre (~4 s for 3 pages) rather than multiplying across all centres.
  await Promise.all(centres.map(async (c) => {
    let raw: Array<Record<string, unknown>>;
    try {
      raw = await getNearbyPlaces(c.lat, c.lng, "establishment", SEARCH_RADIUS_PER_CENTRE, keyword) as Array<Record<string, unknown>>;
    } catch {
      raw = [];
    }
    for (const p of raw) {
      const pid = String(p["place_id"] ?? "");
      if (!pid || seen.has(pid)) continue;
      const loc = ((p["geometry"] as Record<string, unknown>)?.["location"] ?? {}) as Record<string, unknown>;
      const plat = Number(loc["lat"]);
      const plng = Number(loc["lng"]);
      if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
      const dist = haversineM(lat, lng, plat, plng);
      if (dist > EFF_RADIUS) continue; // only include places inside requested radius
      const rating = typeof p["rating"] === "number" ? p["rating"] : null;
      const reviewCount = typeof p["user_ratings_total"] === "number" ? p["user_ratings_total"] : 0;
      const seoScore = Math.min(100, Math.round(((rating ?? 0) / 5) * 60 + Math.min(40, Math.log10(reviewCount + 1) * 13)));
      const threatLevel = seoScore >= 80 ? "critical" : seoScore >= 60 ? "high" : seoScore >= 40 ? "medium" : "low";
      seen.set(pid, {
        placeId: pid,
        name: String(p["name"] ?? ""),
        vicinity: String(p["vicinity"] ?? ""),
        lat: plat,
        lng: plng,
        rating,
        reviewCount,
        distanceM: dist,
        seoScore,
        threatLevel,
        types: (p["types"] as string[]) ?? [],
      });
    }
  }));

  // Return sorted by distance so nearest competitors appear first on the map
  return Array.from(seen.values()).sort(
    (a, b) => (a["distanceM"] as number) - (b["distanceM"] as number),
  );
}

/**
 * Fetches full Google Place Details for a place the user clicked on the map.
 * Returns a compact, frontend-ready shape: name, rating, review count,
 * address, phone, website, opening status and a proxied photo URL.
 */
export async function getPlaceDetails(placeId: string): Promise<Record<string, unknown> | null> {
  const apiKey = getMapsApiKey();
  if (!apiKey) throw new Error("Google Maps API key not configured");
  const fields = [
    "place_id", "name", "rating", "user_ratings_total", "formatted_address",
    "formatted_phone_number", "website", "opening_hours", "photos", "types", "url",
  ].join(",");
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&language=fr&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json() as Record<string, unknown>;
  const r = data["result"] as Record<string, unknown> | undefined;
  if (!r) return null;
  const photos = (r["photos"] as Array<Record<string, unknown>>) ?? [];
  const photoRef = photos.length > 0 ? String(photos[0]["photo_reference"] ?? "") : "";
  return {
    placeId: String(r["place_id"] ?? placeId),
    name: String(r["name"] ?? ""),
    rating: typeof r["rating"] === "number" ? r["rating"] : null,
    reviewCount: typeof r["user_ratings_total"] === "number" ? r["user_ratings_total"] : null,
    address: r["formatted_address"] ?? null,
    phone: r["formatted_phone_number"] ?? null,
    website: r["website"] ?? null,
    openNow: (r["opening_hours"] as Record<string, unknown>)?.["open_now"] ?? null,
    types: (r["types"] as string[]) ?? [],
    googleUrl: r["url"] ?? null,
    photoUrl: photoRef ? `/api/maps/photo?ref=${encodeURIComponent(photoRef)}` : null,
  };
}

/** Streams a Google Places photo (keeps the API key server-side). */
export async function fetchPlacePhoto(photoRef: string, maxWidth = 400): Promise<{ contentType: string; body: Buffer } | null> {
  const apiKey = getMapsApiKey();
  if (!apiKey) throw new Error("Google Maps API key not configured");
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${encodeURIComponent(photoRef)}&key=${apiKey}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) return null;
  const body = Buffer.from(await res.arrayBuffer());
  return { contentType, body };
}
