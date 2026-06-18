import { Router, type Request, type Response } from "express";
import { db, monitorsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

// ── In-memory SSE client registry ──────────────────────────────────────────
const clients = new Set<Response>();

/** Broadcast an event to all connected SSE clients */
export function broadcastSSE(eventType: string, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

/** Broadcast a generic message event */
export function broadcastMessage(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// ── GET /events — SSE stream ────────────────────────────────────────────────
router.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  clients.add(res);

  // Send initial welcome + current monitor snapshot
  (async () => {
    try {
      const monitors = await db
        .select()
        .from(monitorsTable)
        .orderBy(desc(monitorsTable.createdAt))
        .limit(50);

      const down = monitors.filter((m) => m.status === "down").length;

      res.write(
        `event: init\ndata: ${JSON.stringify({
          type: "init",
          clientCount: clients.size,
          monitors: monitors.map((m) => ({
            id: m.id,
            name: m.name,
            status: m.status,
            uptime: m.uptime,
            latency: m.latency,
          })),
          summary: { total: monitors.length, down, up: monitors.length - down },
          ts: Date.now(),
        })}\n\n`
      );
    } catch {
      res.write(`event: init\ndata: ${JSON.stringify({ type: "init", ts: Date.now() })}\n\n`);
    }
  })();

  // Heartbeat every 25s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 25_000);

  // Monitor poll every 30s — push diffs to this client
  const monitorPoll = setInterval(async () => {
    try {
      const monitors = await db.select().from(monitorsTable).limit(50);
      res.write(
        `event: monitor_snapshot\ndata: ${JSON.stringify({
          type: "monitor_snapshot",
          monitors: monitors.map((m) => ({
            id: m.id,
            name: m.name,
            status: m.status,
            uptime: m.uptime,
            latency: m.latency,
            lastCheck: m.lastCheck,
          })),
          ts: Date.now(),
        })}\n\n`
      );
    } catch {
      clearInterval(monitorPoll);
    }
  }, 30_000);

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(monitorPoll);
    clients.delete(res);
  });

  req.on("error", () => {
    clearInterval(heartbeat);
    clearInterval(monitorPoll);
    clients.delete(res);
  });
});

// ── GET /events/status — simple health check for SSE subsystem ─────────────
router.get("/events/status", (_req, res) => {
  res.json({ clients: clients.size, ok: true, ts: Date.now() });
});

export default router;
