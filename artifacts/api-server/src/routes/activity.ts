import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { canWrite } from "../middlewares/requireRole.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/activity", async (req: Request, res: Response) => {
  try {
    const orgId    = (req as Request & { orgId?: string }).orgId ?? "default";
    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const limit    = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawPage  = parseInt(String(req.query.page  ?? "0"), 10);
    const page     = Number.isFinite(rawPage)  ? Math.max(rawPage, 0) : 0;
    const type     = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;

    const offset = page * limit;
    const result = await store.getFilteredActivityPage({ limit, offset, type, orgId });

    // A genuine query/connection failure must NOT be served as an empty feed
    // (which the client would render as "no activity"). Surface it as 500 so
    // the caller can retry instead of caching a false-empty page.
    if (result.error) {
      res.status(500).json({ error: "activity_fetch_failed" });
      return;
    }

    // Expose the TRUE total (distinct from the returned page size) via headers
    // so even legacy array consumers get pagination metadata.
    res.setHeader("X-Total-Count", String(result.total));
    res.setHeader("X-Page-Size", String(result.events.length));
    res.setHeader("X-Has-More", result.hasMore ? "1" : "0");

    // Backward compatibility: existing frontend/timeline consumers expect a
    // bare array. Opt into the richer envelope with ?meta=1 (or ?format=page).
    const wantsEnvelope =
      req.query.meta === "1" || req.query.meta === "true" || req.query.format === "page";

    if (wantsEnvelope) {
      res.json({
        events: result.events,     // this page's slice
        pageSize: result.events.length, // number actually returned
        total: result.total,       // true total across all pages
        hasMore: result.hasMore,
        limit: result.limit,
        offset: result.offset,
        page,
      });
      return;
    }

    res.json(result.events);
  } catch (err) {
    logger.error({ err }, "[activity] GET /activity failed");
    res.status(500).json({ error: "activity_fetch_failed" });
  }
});

router.post("/activity", canWrite, async (req: Request, res: Response) => {
  const orgId = (req as Request & { orgId?: string }).orgId ?? "default";
  const { type, label, targetId, targetType, metadata } = req.body || {};
  if (typeof type !== "string" || !type || typeof label !== "string" || !label) {
    res.status(400).json({ error: "type and label are required strings" }); return;
  }
  try {
    // userId/userName are intentionally NOT accepted from client — actor identity is server-authoritative
    await store.logActivity({ type, label, targetId, targetType, metadata, orgId });
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
