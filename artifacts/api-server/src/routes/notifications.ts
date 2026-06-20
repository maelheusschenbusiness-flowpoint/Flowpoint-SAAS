import { Router } from "express";
import { connectMongo } from "../lib/mongo.js";
import { NotificationModel } from "../models/Notification.js";
import { isDemoMode } from "../services/mock-data.js";
import { logger } from "../lib/logger.js";

const router = Router();

const SEED = [
  { _id: "notif1", type: "warning", title: "Monitor en alerte", message: "Boulangerie Martin — temps de réponse > 3s", read: false },
  { _id: "notif2", type: "success", title: "Audit terminé",     message: "monagence.fr — Score 82/100 (+7 pts)",       read: false },
  { _id: "notif3", type: "info",    title: "Rapport envoyé",    message: "Rapport Mai 2026 envoyé à Restaurant Le Soleil", read: true },
  { _id: "notif4", type: "error",   title: "Monitor DOWN",      message: "Coiffeur Lyon — indisponible depuis 12 min", read: false },
  { _id: "notif5", type: "info",    title: "Nouveau membre",    message: "Sophie Martin a rejoint le workspace",       read: true },
  { _id: "notif6", type: "warning", title: "Limite d'usage",    message: "Audits : 87/100 utilisés ce mois-ci",       read: false },
];

async function ensureSeed() {
  if (!isDemoMode()) return;
  const count = await NotificationModel.countDocuments();
  if (count === 0) {
    await NotificationModel.insertMany(SEED, { ordered: false }).catch(() => {});
  }
}

router.get("/notifications", async (_req, res) => {
  try {
    await connectMongo();
    await ensureSeed();
    const notifs = await NotificationModel.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json(notifs.map(n => ({ ...n, id: n._id })));
  } catch (err) {
    logger.warn({ err }, "[notifications] GET failed");
    res.json([]);
  }
});

router.post("/notifications", async (req, res) => {
  const { type = "info", title, message, link } = req.body as {
    type?: string; title?: string; message?: string; link?: string;
  };
  if (!title || !message) { res.status(400).json({ error: "title and message required" }); return; }
  try {
    await connectMongo();
    const notif = await NotificationModel.create({
      _id: `notif${Date.now()}`, type, title, message, link: link || null, read: false,
    });
    res.status(201).json(notif.toJSON());
  } catch (err) {
    logger.error({ err }, "[notifications] POST failed");
    res.status(500).json({ error: "Failed to create notification" });
  }
});

router.patch("/notifications/:id/read", async (req, res) => {
  try {
    await connectMongo();
    const notif = await NotificationModel.findByIdAndUpdate(
      req.params.id, { $set: { read: true } }, { new: true, lean: true },
    );
    res.json(notif ? { ...notif, id: notif._id } : { ok: true });
  } catch (err) {
    logger.error({ err }, "[notifications] PATCH read failed");
    res.status(500).json({ error: "Failed to mark read" });
  }
});

router.patch("/notifications/read-all", async (_req, res) => {
  try {
    await connectMongo();
    await NotificationModel.updateMany({}, { $set: { read: true } });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[notifications] PATCH read-all failed");
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

router.delete("/notifications/:id", async (req, res) => {
  try {
    await connectMongo();
    await NotificationModel.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

export default router;
