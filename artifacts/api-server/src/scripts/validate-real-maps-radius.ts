import { analyzeCompetitors, isMapsConfigured } from "../services/maps-service.js";

const CENTER = { lat: 48.8566, lng: 2.3522 }; // Paris
const RADII_METERS = [5_000, 20_000, 50_000, 100_000] as const;
const KEYWORD = "restaurant";

type Competitor = {
  placeId?: unknown;
  name?: unknown;
  distanceM?: unknown;
};

if (process.env["RUN_REAL_MAPS_CERT"] !== "1") {
  throw new Error("Set RUN_REAL_MAPS_CERT=1 to authorize real, billable Google Maps requests.");
}
if (process.env["NODE_ENV"] === "production") {
  throw new Error("The real Maps certification script cannot run in production.");
}
if (!isMapsConfigured()) {
  throw new Error("No server-side Google Maps key is configured.");
}

for (const radiusM of RADII_METERS) {
  const places = await analyzeCompetitors(
    CENTER.lat,
    CENTER.lng,
    KEYWORD,
    radiusM,
  ) as Competitor[];

  const ids = places.map(place => String(place.placeId ?? ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`Radius ${radiusM}: results contain a missing or duplicate placeId.`);
  }

  const distances = places.map(place => Number(place.distanceM));
  if (distances.some(distance => !Number.isFinite(distance) || distance > radiusM)) {
    throw new Error(`Radius ${radiusM}: a result is invalid or outside the requested radius.`);
  }
  if (distances.some((distance, index) => index > 0 && distance < distances[index - 1]!)) {
    throw new Error(`Radius ${radiusM}: results are not sorted by distance.`);
  }
  if (!places.length) {
    throw new Error(`Radius ${radiusM}: Google returned no restaurants; certification is inconclusive.`);
  }

  const first = places[0]!;
  console.log(JSON.stringify({
    radiusM,
    count: places.length,
    uniquePlaceIds: new Set(ids).size,
    maxDistanceM: Math.round(Math.max(...distances)),
    allWithinRadius: true,
    first: {
      name: String(first.name ?? ""),
      placeId: String(first.placeId),
      distanceM: Math.round(Number(first.distanceM)),
    },
  }));
}
