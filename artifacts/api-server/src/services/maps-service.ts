export function isMapsConfigured(): boolean {
  return !!process.env["GOOGLE_MAPS_API_KEY"];
}

export async function geocodeAddress(address: string): Promise<{
  lat: number; lng: number; formattedAddress: string; placeId: string;
} | null> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
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

export async function getNearbyPlaces(lat: number, lng: number, type: string, radius = 5000): Promise<unknown[]> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) throw new Error("Google Maps API key not configured");
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json() as Record<string, unknown>;
  return (data["results"] as unknown[]) ?? [];
}

export async function getDistanceMatrix(origins: string[], destinations: string[]): Promise<unknown> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
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
export async function analyzeCompetitors(lat: number, lng: number, keyword: string, radius = 5000): Promise<unknown[]> {
  void keyword; // type-based nearby search; keyword ranking comes from DataForSEO
  const raw = await getNearbyPlaces(lat, lng, "establishment", radius) as Array<Record<string, unknown>>;
  const out: Array<Record<string, unknown>> = [];
  for (const p of raw) {
    const loc = ((p["geometry"] as Record<string, unknown>)?.["location"] ?? {}) as Record<string, unknown>;
    const plat = Number(loc["lat"]);
    const plng = Number(loc["lng"]);
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue; // never emit NaN markers
    const rating = typeof p["rating"] === "number" ? p["rating"] : null;
    const reviewCount = typeof p["user_ratings_total"] === "number" ? p["user_ratings_total"] : 0;
    const seoScore = Math.min(100, Math.round(((rating ?? 0) / 5) * 60 + Math.min(40, Math.log10(reviewCount + 1) * 13)));
    const threatLevel = seoScore >= 80 ? "critical" : seoScore >= 60 ? "high" : seoScore >= 40 ? "medium" : "low";
    out.push({
      placeId: String(p["place_id"] ?? ""),
      name: String(p["name"] ?? ""),
      vicinity: String(p["vicinity"] ?? ""),
      lat: plat,
      lng: plng,
      rating,
      reviewCount,
      distanceM: haversineM(lat, lng, plat, plng),
      seoScore,
      threatLevel,
      types: (p["types"] as string[]) ?? [],
    });
  }
  return out;
}

/**
 * Fetches full Google Place Details for a place the user clicked on the map.
 * Returns a compact, frontend-ready shape: name, rating, review count,
 * address, phone, website, opening status and a proxied photo URL.
 */
export async function getPlaceDetails(placeId: string): Promise<Record<string, unknown> | null> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
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
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) throw new Error("Google Maps API key not configured");
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${encodeURIComponent(photoRef)}&key=${apiKey}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) return null;
  const body = Buffer.from(await res.arrayBuffer());
  return { contentType, body };
}
