import { Router } from "express";
import { db, teamMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { store } from "../services/store.js";

const router = Router();

const SEED: Array<typeof teamMessagesTable.$inferInsert> = [
  { id: "msg1", channel: "general", from: "Sophie M.", text: "Rapport Mai envoyé à tous les clients ✓", self: false },
  { id: "msg2", channel: "general", from: "Maël H.", text: "Super ! J'ai aussi mis à jour les monitors pour Boulangerie Martin.", self: true },
  { id: "msg3", channel: "general", from: "Thomas R.", text: "Le score SEO de monagence.fr est passé à 82/100 🎉", self: false },
  { id: "msg4", channel: "seo", from: "Sophie M.", text: "Attention : VisibilityFirst a gagné 15 positions sur nos mots-clés principaux", self: false },
  { id: "msg5", channel: "seo", from: "Maël H.", text: "Je lance un audit complet ce soir pour analyser l'écart.", self: true },
  { id: "msg6", channel: "rapports", from: "Thomas R.", text: "Template rapport Q2 prêt — à valider avant envoi", self: false },
];

async function ensureSeed() {
  const existing = await db.select().from(teamMessagesTable).limit(1);
  if (existing.length === 0) {
    await db.insert(teamMessagesTable).values(SEED).onConflictDoNothing();
  }
}

router.get("/team/messages", async (req, res) => {
  try {
    await ensureSeed();
    const channel = (req.query.channel as string) || "general";
    const messages = await db
      .select()
      .from(teamMessagesTable)
      .where(eq(teamMessagesTable.channel, channel))
      .orderBy(desc(teamMessagesTable.createdAt))
      .limit(100);
    res.json(messages.reverse());
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/team/messages", async (req, res) => {
  const { channel = "general", from, text, self: isSelf = false } = req.body as Partial<typeof teamMessagesTable.$inferInsert>;
  if (!text || !from) { res.status(400).json({ error: "text and from required" }); return; }
  try {
    const [msg] = await db.insert(teamMessagesTable).values({
      id: "msg" + Date.now(),
      channel, from, text, self: isSelf,
    }).returning();

    store.broadcast({ type: "chat:message", channel, message: msg });

    res.status(201).json(msg);
  } catch (e) {
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.delete("/team/messages/:id", async (req, res) => {
  await db.delete(teamMessagesTable).where(eq(teamMessagesTable.id, req.params.id));
  res.json({ ok: true });
});

export default router;
