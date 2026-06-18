import { Router, type Request, type Response } from "express";
import {
  isMapsConfigured,
  geocodeAddress,
  getNearbyPlaces,
  getDistanceMatrix,
  getHeatmapData,
  analyzeCompetitors,
} from "../services/maps-service.js";

const router = Router();

router.get("/maps/config", (_req: Request, res: Response) => {
  res.json({
    configured: isMapsConfigured(),
    apiKey: process.env["GOOGLE_MAPS_API_KEY"] ?? "",
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
  const radius = Math.min(20000, parseInt(req.query["radius"] as string) || 5000);
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

export default router;
