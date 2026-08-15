import { Router, type Request, type Response } from "express";
import {
  isMapsConfigured,
  geocodeAddress,
  getNearbyPlaces,
  getDistanceMatrix,
  getHeatmapData,
  analyzeCompetitors,
  getPlaceDetails,
  fetchPlacePhoto,
} from "../services/maps-service.js";

const router = Router();

router.get("/maps/config", (_req: Request, res: Response) => {
  // SECURITY: only a dedicated browser key may ever be serialized here.
  // GOOGLE_MAPS_API_KEY and GOOGLE_API_KEY are server-side bearer credentials
  // (Geocoding/Places/Distance Matrix/photo proxy) and must NEVER reach the
  // browser — any API enabled on those keys travels with them. If no
  // referrer-restricted browser key (GOOGLE_MAPS_PUBLIC_KEY or
  // GOOGLE_MAPS_BROWSER_KEY) is configured, the frontend shows a visible
  // "map not configured" error instead of receiving a server key.
  const publicKey =
    process.env["GOOGLE_MAPS_PUBLIC_KEY"] ??
    process.env["GOOGLE_MAPS_BROWSER_KEY"] ??
    "";
  res.json({
    configured: !!publicKey,
    serverConfigured: isMapsConfigured(),
    apiKey: publicKey,
    // Hint for the visible error state: server-side Maps REST works, but no
    // browser-safe key is configured for the interactive map.
    missingBrowserKey: !publicKey && isMapsConfigured(),
  });
});

router.post("/maps/geocode", async (req: Request, res: Response) => {
  const { address } = req.body ?? {};
  if (!address || typeof address !== "string") {
    res.status(400).json({ error: "address required" }); return;
  }
  try {
    const result = await geocodeAddress(address);
    if (!result) { res.status(404).json({ error: "Address not found" }); return; }
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Geocode failed";
    if (msg.includes("not configured")) { res.status(503).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

router.get("/maps/nearby", async (req: Request, res: Response) => {
  const lat = parseFloat(req.query["lat"] as string);
  const lng = parseFloat(req.query["lng"] as string);
  const keyword = (req.query["keyword"] as string) || "";
  const radius = Math.min(50000, parseInt(req.query["radius"] as string) || 3000);
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng required" }); return;
  }
  try {
    const places = await getNearbyPlaces(lat, lng, keyword, radius);
    res.json({ places, count: places.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Nearby search failed";
    res.status(500).json({ error: msg });
  }
});

router.post("/maps/distance", async (req: Request, res: Response) => {
  const { origins, destinations } = req.body ?? {};
  if (!Array.isArray(origins) || !Array.isArray(destinations)) {
    res.status(400).json({ error: "origins and destinations arrays required" }); return;
  }
  try {
    const results = await getDistanceMatrix(origins as string[], destinations as string[]);
    res.json({ results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Distance matrix failed";
    res.status(500).json({ error: msg });
  }
});

router.get("/maps/heatmap", async (req: Request, res: Response) => {
  const lat = parseFloat(req.query["lat"] as string);
  const lng = parseFloat(req.query["lng"] as string);
  const radius = Math.min(20000, parseInt(req.query["radius"] as string) || 5000);
  const keyword = (req.query["keyword"] as string) || "";
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng required" }); return;
  }
  try {
    const zones = await getHeatmapData(lat, lng, radius, keyword);
    res.json({ zones, center: { lat, lng }, radius });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Heatmap failed";
    res.status(500).json({ error: msg });
  }
});

router.get("/maps/competitors", async (req: Request, res: Response) => {
  const lat = parseFloat(req.query["lat"] as string);
  const lng = parseFloat(req.query["lng"] as string);
  const keyword = (req.query["keyword"] as string) || "";
  const radius = Math.min(50000, parseInt(req.query["radius"] as string) || 5000);
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng required" }); return;
  }
  try {
    const competitors = await analyzeCompetitors(lat, lng, keyword, radius);
    res.json({ competitors, count: competitors.length, center: { lat, lng } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Competitor analysis failed";
    res.status(500).json({ error: msg });
  }
});

router.get("/maps/place-details", async (req: Request, res: Response) => {
  const placeId = (req.query["placeId"] as string) || "";
  if (!placeId || placeId.length > 300) {
    res.status(400).json({ error: "placeId required" }); return;
  }
  try {
    const details = await getPlaceDetails(placeId);
    if (!details) { res.status(404).json({ error: "Place not found" }); return; }
    res.json(details);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Place details failed";
    if (msg.includes("not configured")) { res.status(503).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

router.get("/maps/photo", async (req: Request, res: Response) => {
  const ref = (req.query["ref"] as string) || "";
  const width = Math.min(1200, Math.max(100, parseInt(req.query["w"] as string) || 400));
  // Google photo_reference values routinely run 600-700 chars (Nearby Search
  // refs observed at 644-671); 1000 keeps a sane DoS bound without rejecting
  // legitimate refs.
  if (!ref || ref.length > 1000) { res.status(400).json({ error: "ref required" }); return; }
  try {
    const photo = await fetchPlacePhoto(ref, width);
    if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(photo.body);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Photo fetch failed";
    if (msg.includes("not configured")) { res.status(503).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

export default router;
