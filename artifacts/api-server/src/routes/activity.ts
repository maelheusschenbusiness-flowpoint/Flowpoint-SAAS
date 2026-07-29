import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { canWrite } from "../middlewares/requireRole.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/activity", async (req: Request, res: Response) => {
  try {
    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const limit    = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawPage  = parseInt(String(req.query.page  ?? "0"), 10);
    const page     = Number.isFinite(rawPage)  ? Math.max(rawPage, 0) : 0;
    const type     = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;

    const events = await store.getFilteredActivity({ limit, offset: page * limit, type });
    res.json(events);
  } catch (err) {
    logger.error({ err }, "[activity] GET /activity failed");
    res.status(500).json({ error: "activity_fetch_failed" });
  }
});

router.post("/activity", canWrite, async (req: Request, res: Response) => {
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
  const orgId = (req as Request & { orgId?: string }).orgId ?? "default";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const send = (data: string) => res.write(data);
  store.addSseClient(orgId, send);

  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    store.removeSseClient(orgId, send);
  });
});

export default router;
