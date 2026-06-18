import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";

const router = Router();

router.get("/activity", async (_req: Request, res: Response) => {
  try {
    const events = await store.getRecentActivity(50);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

router.post("/activity", async (req: Request, res: Response) => {
  const { type, label, targetId, targetType, metadata } = req.body || {};
  if (typeof type !== "string" || !type || typeof label !== "string" || !label) {
    res.status(400).json({ error: "type and label are required strings" }); return;
  }
  try {
    // userId/userName are intentionally NOT accepted from client — actor identity is server-authoritative
    await store.logActivity({ type, label, targetId, targetType, metadata });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to log activity" });
  }
});

// SSE alias: frontend subscribes via /api/billing/events (shared sseClients Set).
// This route provides the same channel under a semantically correct path.
router.get("/activity/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const send = (data: string) => res.write(data);
  store.sseClients.add(send);

  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    store.sseClients.delete(send);
  });
});

export default router;
