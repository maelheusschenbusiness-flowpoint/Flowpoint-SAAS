import { Router } from "express";
import { db, competitorsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { store } from "../services/store.js";
import { isDemoMode } from "../services/mock-data.js";
import { safeErrMsg } from "../lib/safe-error.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";

const router = Router();

const SEED: Array<typeof competitorsTable.$inferInsert> = [
  { id: "comp1", name: "AgenceSEO Pro", url: "https://agenceseopro.fr", domainRating: 52, keywords: 4300, traffic: 28000, threatLevel: "high", delta: 8 },
  { id: "comp2", name: "RéférenMax", url: "https://referencmax.fr", domainRating: 44, keywords: 2800, traffic: 15000, threatLevel: "medium", delta: 3 },
  { id: "comp3", name: "DigitalBoost Paris", url: "https://digitalboost.paris", domainRating: 38, keywords: 1900, traffic: 9200, threatLevel: "low", delta: -2 },
  { id: "comp4", name: "VisibilityFirst", url: "https://visibilityfirst.com", domainRating: 61, keywords: 6800, traffic: 45000, threatLevel: "critical", delta: 15 },
  { id: "comp5", name: "LocalSEO Expert", url: "https://localseoexpert.fr", domainRating: 35, keywords: 1200, traffic: 5600, threatLevel: "low", delta: 1 },
];

async function ensureSeed() {
  if (!isDemoMode()) return; // production: no mock competitors
  const existing = await db.select().from(competitorsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(competitorsTable).values(SEED).onConflictDoNothing();
  }
}

router.get("/competitors", async (_req, res) => {
  try {
    await ensureSeed();
    const competitors = await db.select().from(competitorsTable).orderBy(desc(competitorsTable.domainRating)).limit(200);
    res.json(competitors);
  } catch (e) {
    res.status(500).json({ error: safeErrMsg(e) });
  }
});

router.post("/competitors", reportRateLimit, async (req, res) => {
  const { name, url, domainRating = 0, keywords = 0, traffic = 0, threatLevel = "low" } = req.body as Partial<typeof competitorsTable.$inferInsert>;
  if (!name || !url) { res.status(400).json({ error: "name and url required" }); return; }
  try {
    const [comp] = await db.insert(competitorsTable).values({
      id: "comp" + Date.now(),
      name, url,
      domainRating: Number(domainRating),
      keywords: Number(keywords),
      traffic: Number(traffic),
      threatLevel: threatLevel || "low",
      delta: 0,
    }).returning();
    store.logActivity({ type: "alert", label: `Concurrent ajouté : ${name}`, targetId: comp.id, targetType: "competitor" }).catch(() => {});
    res.status(201).json(comp);
  } catch (e) {
    res.status(500).json({ error: safeErrMsg(e) });
  }
});

router.delete("/competitors/:id", async (req, res) => {
  await db.delete(competitorsTable).where(eq(competitorsTable.id, req.params.id));
  res.json({ ok: true });
});

export default router;
