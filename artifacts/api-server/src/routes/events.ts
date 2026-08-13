import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { store } from "../services/store.js";

const router = Router();

// ── In-memory SSE client registry — scoped by org_id ─────────────────────────────────────
const clients = new Map<string, Set<Response>>();

function getOrgClients(orgId: string): Set<Response> {
  if (!clients.has(orgId)) clients.set(orgId, new Set());
  return clients.get(orgId)!;
}

/** Broadcast an event to SSE clients of a specific org (or all if no orgId given) */
export function broadcastSSE(eventType: string, data: unknown, orgId?: string): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  if (orgId) {
    const orgSet = clients.get(orgId);
    if (orgSet) {
      for (const res of orgSet) {
        try { res.write(payload); } catch { orgSet.delete(res); }
      }
    }
  } else {
    for (const orgSet of clients.values()) {
      for (const res of orgSet) {
        try { res.write(payload); } catch { orgSet.delete(res); }
      }
    }
  }
}

/** Broadcast a generic message event */
export function broadcastMessage(data: unknown, orgId?: string): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  if (orgId) {
    const orgSet = clients.get(orgId);
    if (orgSet) {
      for (const res of orgSet) {
        try { res.write(payload); } catch { orgSet.delete(res); }
      }
    }
  } else {
    for (const orgSet of clients.values()) {
      for (const res of orgSet) {
        try { res.write(payload); } catch { orgSet.delete(res); }
      }
    }
  }
}

// ── GET /events — SSE stream (authentifié + scopé par org) ────────────────────────
router.get("/events", (req: Request, res: Response) => {
  const orgId = req.orgContext?.orgId ?? "default";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const orgSet = getOrgClients(orgId);
  orgSet.add(res);

  // ── BRIDGE: register this client in store._sseByOrg so store.broadcast()
  // (used by team chat, audit events, billing updates, etc.) reaches /api/events
  // clients. Without this bridge the two SSE registries are completely disjoint.
  const storeSend = (data: string): void => {
    try { res.write(data); } catch { orgSet.delete(res); store.removeSseClient(orgId, storeSend); }
  };
  store.addSseClient(orgId, storeSend);

  // Send initial welcome + org-scoped monitor snapshot
  (async () => {
    try {
      const result = await req.orgDb(
        `SELECT id, name, status, uptime, latency, last_check AS "lastCheck", created_at AS "createdAt"
         FROM monitors WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [orgId]
      );
      const monitors = result.rows;
      const down = monitors.filter((m) => m.status === "down").length;
      res.write(
        `event: init\ndata: ${JSON.stringify({
          type: "init",
          clientCount: orgSet.size,
          monitors: monitors.map((m) => ({
            id: m.id,
            name: m.name,
            status: m.status,
            uptime: m.uptime,
            latency: m.latency,
            lastCheck: m.lastCheck,
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
      orgSet.delete(res);
    }
  }, 25_000);

  // Monitor poll every 30s — push org-scoped diffs to this client
  const monitorPoll = setInterval(async () => {
    try {
      const result = await req.orgDb(
        `SELECT id, name, status, uptime, latency, last_check AS "lastCheck", created_at AS "createdAt"
         FROM monitors WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [orgId]
      );
      const monitors = result.rows;
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
    orgSet.delete(res);
    store.removeSseClient(orgId, storeSend);
  });

  req.on("error", () => {
    clearInterval(heartbeat);
    clearInterval(monitorPoll);
    orgSet.delete(res);
    store.removeSseClient(orgId, storeSend);
  });
});

// ── GET /events/status — simple health check for SSE subsystem ───────────
router.get("/events/status", (_req, res) => {
  let totalClients = 0;
  for (const orgSet of clients.values()) totalClients += orgSet.size;
  res.json({ clients: totalClients, orgs: clients.size, ok: true, ts: Date.now() });
});

export default router;
