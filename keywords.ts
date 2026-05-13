import { Router } from "express";
import { db, keywordsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { store } from "../services/store.js";

const router = Router();

const SEED: Array<typeof keywordsTable.$inferInsert> = [
  { id: "kw1", keyword: "agence seo paris", position: 3, prevPosition: 5, volume: 1900, difficulty: 62, trend: "up", tag: "Local" },
  { id: "kw2", keyword: "audit seo gratuit", position: 7, prevPosition: 6, volume: 4400, difficulty: 48, trend: "down", tag: "Acquisition" },
  { id: "kw3", keyword: "référencement naturel entreprise", position: 12, prevPosition: 14, volume: 2200, difficulty: 55, trend: "up", tag: "Notoriété" },
  { id: "kw4", keyword: "consultant seo freelance", position: 4, prevPosition: 4, volume: 880, difficulty: 43, trend: "stable", tag: "Local" },
  { id: "kw5", keyword: "optimisation google my business", position: 2, prevPosition: 3, volume: 3600, difficulty: 38, trend: "up", tag: "Local SEO" },
  { id: "kw6", keyword: "backlinks de qualité", position: 18, prevPosition: 15, volume: 1300, difficulty: 71, trend: "down", tag: "Netlinking" },
  { id: "kw7", keyword: "core web vitals optimisation", position: 9, prevPosition: 11, volume: 720, difficulty: 52, trend: "up", tag: "Technique" },
  { id: "kw8", keyword: "seo local restaurant paris", position: 1, prevPosition: 1, volume: 590, difficulty: 29, trend: "stable", tag: "Local" },
];

async function ensureSeed() {
  const existing = await db.select().from(keywordsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(keywordsTable).values(SEED).onConflictDoNothing();
  }
}

router.get("/keywords", async (_req, res) => {
  try {
    await ensureSeed();
    const keywords = await db.select().from(keywordsTable).orderBy(keywordsTable.position);
    res.json(keywords);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch keywords" });
  }
});

router.post("/keywords", async (req, res) => {
  const { keyword, position = 0, volume = 0, difficulty = 50, tag } = req.body as Partial<typeof keywordsTable.$inferInsert>;
  if (!keyword) { res.status(400).json({ error: "keyword required" }); return; }
  try {
    const [kw] = await db.insert(keywordsTable).values({
      id: "kw" + Date.now(),
      keyword,
      position: Number(position),
      prevPosition: Number(position),
      volume: Number(volume),
      difficulty: Number(difficulty),
      trend: "stable",
      tag: tag || null,
    }).returning();
    store.logActivity({ type: "audit", label: `Keyword ajouté : ${keyword}`, targetId: kw.id, targetType: "keyword" }).catch(() => {});
    res.status(201).json(kw);
  } catch (e) {
    res.status(500).json({ error: "Failed to create keyword" });
  }
});

router.patch("/keywords/:id", async (req, res) => {
  const updates = req.body as Partial<typeof keywordsTable.$inferInsert>;
  try {
    const [kw] = await db.update(keywordsTable).set(updates).where(eq(keywordsTable.id, req.params.id)).returning();
    if (!kw) { res.status(404).json({ error: "not found" }); return; }
    res.json(kw);
  } catch (e) {
    res.status(500).json({ error: "Failed to update keyword" });
  }
});

router.delete("/keywords/:id", async (req, res) => {
  await db.delete(keywordsTable).where(eq(keywordsTable.id, req.params.id));
  res.json({ ok: true });
});

export default router;
