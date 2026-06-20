import { Router } from "express";
import { db, teamMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { store } from "../services/store.js";
import { isDemoMode } from "../services/mock-data.js";

const router = Router();

const SEED: Array<typeof teamMessagesTable.$inferInsert> = [
  { id: "msg1", channel: "general",  senderId: "sophie-m",  senderName: "Sophie M.",  content: "Rapport Mai envoyé à tous les clients ✓",                                        type: "text" },
  { id: "msg2", channel: "general",  senderId: "mael-h",    senderName: "Maël H.",    content: "Super ! J'ai aussi mis à jour les monitors pour Boulangerie Martin.",            type: "text" },
  { id: "msg3", channel: "general",  senderId: "thomas-r",  senderName: "Thomas R.",  content: "Le score SEO de monagence.fr est passé à 82/100 🎉",                            type: "text" },
  { id: "msg4", channel: "seo",      senderId: "sophie-m",  senderName: "Sophie M.",  content: "Attention : VisibilityFirst a gagné 15 positions sur nos mots-clés principaux", type: "text" },
  { id: "msg5", channel: "seo",      senderId: "mael-h",    senderName: "Maël H.",    content: "Je lance un audit complet ce soir pour analyser l'écart.",                      type: "text" },
  { id: "msg6", channel: "rapports", senderId: "thomas-r",  senderName: "Thomas R.",  content: "Template rapport Q2 prêt — à valider avant envoi",                             type: "text" },
];

async function ensureSeed() {
  if (!isDemoMode()) return;
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
  } catch {
    res.json([]);
  }
});

router.post("/team/messages", async (req, res) => {
  const { channel = "general", from, text } = req.body as { channel?: string; from?: string; text?: string };
  if (!text || !from) { res.status(400).json({ error: "text and from required" }); return; }
  try {
    const [msg] = await db.insert(teamMessagesTable).values({
      id:         "msg" + Date.now(),
      channel,
      senderId:   "user",
      senderName: from,
      content:    text,
      type:       "text",
    }).returning();

    store.broadcast({ type: "chat:message", channel, message: msg });

    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.delete("/team/messages/:id", async (req, res) => {
  await db.delete(teamMessagesTable).where(eq(teamMessagesTable.id, req.params.id));
  res.json({ ok: true });
});

export default router;
