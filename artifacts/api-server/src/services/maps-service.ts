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
export async function getHeatmapData(keyword: string, location: string, gridSize = 9): Promise<Array<{ lat: number; lng: number; rank: number | null }>> {
  void keyword; // reserved for DataForSEO batch job
  const geo = await geocodeAddress(location).catch(() => null);
  if (!geo) return [];
  const step = 0.01;
  const half = Math.floor(gridSize / 2);
  const points: Array<{ lat: number; lng: number; rank: number | null }> = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      points.push({ lat: geo.lat + i * step, lng: geo.lng + j * step, rank: null });
    }
  }
  return points;
}

export async function analyzeCompetitors(lat: number, lng: number, keyword: string): Promise<unknown[]> {
  return getNearbyPlaces(lat, lng, "establishment");
}
