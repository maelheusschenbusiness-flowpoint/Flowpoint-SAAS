import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  listMonitors, getMonitor, createMonitor, updateMonitor, deleteMonitor,
  pauseMonitor, resumeMonitor, getMonitorSLA, getResponseTimes,
  listIncidents, getIncident, acknowledgeIncident,
  listHeartbeats, createHeartbeat,
  listStatusPages, createStatusPage,
  getMonitoringStats, isBSConfigured,
} from "../services/betterstack-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Guard: require BETTERSTACK_API_TOKEN ───────────────────────────────────────
function requireBS(res: Parameters<typeof router.get>[1] extends (_: never, r: infer R) => void ? R : never) {
  if (!isBSConfigured()) {
    (res as unknown as import("express").Response).status(503).json({
      error: "Better Stack not configured. Set BETTERSTACK_API_TOKEN.",
      configured: false,
    });
    return false;
  }
  return true;
}

// ── Config check ───────────────────────────────────────────────────────────────
router.get("/betterstack/config", (_req, res) => {
  res.json({ configured: isBSConfigured() });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get("/betterstack/stats", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const stats = await getMonitoringStats(orgId);
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "[BS] stats error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

// ── Monitors ──────────────────────────────────────────────────────────────────
router.get("/betterstack/monitors", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const monitors = await listMonitors(orgId);
    res.json({ data: monitors, count: monitors.length });
  } catch (err) {
    logger.error({ err }, "[BS] list monitors error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/monitors/:id", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const monitor = await getMonitor(req.params.id);
    res.json(monitor);
  } catch (err) {
    logger.error({ err }, "[BS] get monitor error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/monitors", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const { url, name, monitor_type, check_frequency, regions, required_keyword, verify_ssl, follow_redirects } = req.body as {
      url?: string; name?: string; monitor_type?: string; check_frequency?: number;
      regions?: string[]; required_keyword?: string; verify_ssl?: boolean; follow_redirects?: boolean;
    };
    if (!url || !name) { res.status(400).json({ error: "url and name required" }); return; }
    const monitor = await createMonitor(orgId, { url, name, monitor_type, check_frequency, regions, required_keyword, verify_ssl, follow_redirects });
    res.status(201).json(monitor);
  } catch (err) {
    logger.error({ err }, "[BS] create monitor error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.patch("/betterstack/monitors/:id", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const monitor = await updateMonitor(req.params.id, orgId, req.body);
    res.json(monitor);
  } catch (err) {
    logger.error({ err }, "[BS] update monitor error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.delete("/betterstack/monitors/:id", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    await deleteMonitor(req.params.id, orgId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[BS] delete monitor error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/monitors/:id/pause", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    await pauseMonitor(req.params.id, orgId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/monitors/:id/resume", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    await resumeMonitor(req.params.id, orgId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/monitors/:id/sla", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const data = await getMonitorSLA(req.params.id, from, to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/monitors/:id/response-times", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const period = (req.query["period"] as string) || "24h";
    const data = await getResponseTimes(req.params.id, period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

// ── Incidents ─────────────────────────────────────────────────────────────────
router.get("/betterstack/incidents", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const { monitor_id, from, to, resolved } = req.query as Record<string, string>;
    const incidents = await listIncidents(orgId, {
      monitor_id,
      from,
      to,
      resolved: resolved !== undefined ? resolved === "true" : undefined,
    });
    res.json({ data: incidents, count: incidents.length });
  } catch (err) {
    logger.error({ err }, "[BS] list incidents error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/incidents/:id", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const incident = await getIncident(req.params.id);
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/incidents/:id/acknowledge", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    await acknowledgeIncident(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

// ── Heartbeats ────────────────────────────────────────────────────────────────
router.get("/betterstack/heartbeats", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const hbs = await listHeartbeats(orgId);
    res.json({ data: hbs, count: hbs.length });
  } catch (err) {
    logger.error({ err }, "[BS] list heartbeats error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/heartbeats", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const { name, period, grace, email } = req.body as { name?: string; period?: number; grace?: number; email?: string };
    if (!name || !period) { res.status(400).json({ error: "name and period required" }); return; }
    const hb = await createHeartbeat(orgId, { name, period, grace, email });
    res.status(201).json(hb);
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

// ── Status Pages ──────────────────────────────────────────────────────────────
router.get("/betterstack/status-pages", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const pages = await listStatusPages(orgId);
    res.json({ data: pages, count: pages.length });
  } catch (err) {
    logger.error({ err }, "[BS] list status pages error");
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/status-pages", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const { name, subdomain, custom_domain } = req.body as { name?: string; subdomain?: string; custom_domain?: string };
    if (!name || !subdomain) { res.status(400).json({ error: "name and subdomain required" }); return; }
    const page = await createStatusPage(orgId, { name, subdomain, custom_domain });
    res.status(201).json(page);
  } catch (err) {
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

export default router;
