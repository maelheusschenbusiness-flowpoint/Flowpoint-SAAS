import { Router } from "express";
import { connectMongo } from "../lib/mongo.js";
import { CompetitorModel } from "../models/Competitor.js";
import { store } from "../services/store.js";
import { isDemoMode } from "../services/mock-data.js";
import { safeErrMsg } from "../lib/safe-error.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();

const SEED = [
  { _id: "comp1", name: "AgenceSEO Pro",     url: "https://agenceseopro.fr",     domainRating: 52, keywords: 4300, traffic: 28000, threatLevel: "high",    delta: 8  },
  { _id: "comp2", name: "RéférenMax",        url: "https://referencmax.fr",      domainRating: 44, keywords: 2800, traffic: 15000, threatLevel: "medium",  delta: 3  },
  { _id: "comp3", name: "DigitalBoost Paris",url: "https://digitalboost.paris",  domainRating: 38, keywords: 1900, traffic: 9200,  threatLevel: "low",     delta: -2 },
  { _id: "comp4", name: "VisibilityFirst",   url: "https://visibilityfirst.com", domainRating: 61, keywords: 6800, traffic: 45000, threatLevel: "critical", delta: 15 },
  { _id: "comp5", name: "LocalSEO Expert",   url: "https://localseoexpert.fr",   domainRating: 35, keywords: 1200, traffic: 5600,  threatLevel: "low",     delta: 1  },
];

async function ensureSeed() {
  if (!isDemoMode()) return;
  const count = await CompetitorModel.countDocuments();
  if (count === 0) {
    await CompetitorModel.insertMany(SEED, { ordered: false }).catch(() => {});
  }
}

router.get("/competitors", async (_req, res) => {
  try {
    await connectMongo();
    await ensureSeed();
    const competitors = await CompetitorModel.find().sort({ domainRating: -1 }).limit(200).lean();
    res.json(competitors.map(c => ({ ...c, id: c._id })));
  } catch (e) {
    logger.warn({ err: e }, "[competitors] GET failed (MongoDB unavailable — returning seed)");
    res.json(SEED.map(c => ({ ...c, id: c._id })));
  }
});

router.post("/competitors", reportRateLimit, async (req, res) => {
  const { name, url, domainRating = 0, keywords = 0, traffic = 0, threatLevel = "low" } = req.body as {
    name?: string; url?: string; domainRating?: number; keywords?: number;
    traffic?: number; threatLevel?: string;
  };
  if (!name || !url) { res.status(400).json({ error: "name and url required" }); return; }
  try {
    await connectMongo();
    const comp = await CompetitorModel.create({
      _id: `comp${Date.now()}`, name, url,
      domainRating: Number(domainRating), keywords: Number(keywords),
      traffic: Number(traffic), threatLevel: threatLevel || "low", delta: 0,
    });
    store.logActivity({
      type: "alert", label: `Concurrent ajouté : ${name}`,
      targetId: comp._id as string, targetType: "competitor",
    }).catch(() => {});
    res.status(201).json(comp.toJSON());
  } catch (e) {
    logger.error({ err: e }, "[competitors] POST failed");
    res.status(500).json({ error: safeErrMsg(e) });
  }
});

router.delete("/competitors/:id", async (req, res) => {
  try {
    await connectMongo();
    await CompetitorModel.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

export default router;
