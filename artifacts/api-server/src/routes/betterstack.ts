import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  listMonitors, getMonitor, createMonitor, updateMonitor, deleteMonitor,
  pauseMonitor, resumeMonitor, getMonitorSLA, getResponseTimes,
  listIncidents, getIncident, acknowledgeIncident,
  listHeartbeats, createHeartbeat,
  listStatusPages, createStatusPage,
  getMonitoringStats, isBSConfigured, exigerAppartenance,
} from "../services/betterstack-service.js";
import { evaluateSla, extractAvailability, parseSlaTarget, slaReportCsv, SLA_TARGET_MIN, SLA_TARGET_MAX } from "../services/sla-compliance.js";
import { logger } from "../lib/logger.js";
import { canAdmin, canWrite } from "../middlewares/requireRole.js";
import { pool } from "@workspace/db";
import { registreAppartenancePresent } from "../services/init-bs-ownership.js";
import { summarizeGlobalMonitoring } from "../services/global-monitoring.js";
import { requireAddon } from "../middlewares/planGate.js";

/*
 * GARDES DE ROLE — mesure du 17/10/2026.
 *
 * Aucune des vingt-et-une routes BetterStack ne portait de garde de role. Les
 * routes des moniteurs NATIFS exigent `canAdmin` pour creer, modifier et
 * supprimer. Un simple membre pouvait donc creer, modifier, supprimer, mettre
 * en pause et reprendre un moniteur BetterStack — et chaque creation est
 * facturee a FlowPoint sur le compte partage.
 *
 * Les lectures restent ouvertes aux membres : elles sont deja bornees a
 * l'organisation par `bs_monitor_ownership`.
 */

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
router.get("/betterstack/config", async (_req, res) => {
  // `ownershipRegistry` dit si le registre d'appartenance repond dans CET
  // environnement. Sans lui, l'isolation refuse toute operation client : il
  // faut pouvoir le constater avant de s'appuyer sur la fonctionnalite.
  res.json({
    configured: isBSConfigured(),
    ownershipRegistry: await registreAppartenancePresent(pool),
  });
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
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
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
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/global-overview", requireAddon("globalMonitoring", "Global Monitoring"), async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const monitors = await listMonitors(orgId);
    res.json(summarizeGlobalMonitoring(monitors));
  } catch (err) {
    logger.error({ err }, "[BS] global monitoring overview error");
    res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/monitors/:id", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const monitor = await getMonitor(req.params.id, (req as unknown as { orgId?: string }).orgId ?? "default");
    res.json(monitor);
  } catch (err) {
    logger.error({ err }, "[BS] get monitor error");
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/monitors", canAdmin, async (req, res) => {
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
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.patch("/betterstack/monitors/:id", canAdmin, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const monitor = await updateMonitor(String(req.params.id), orgId, req.body);
    res.json(monitor);
  } catch (err) {
    logger.error({ err }, "[BS] update monitor error");
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.delete("/betterstack/monitors/:id", canAdmin, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    await deleteMonitor(String(req.params.id), orgId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[BS] delete monitor error");
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/monitors/:id/pause", canAdmin, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    await pauseMonitor(String(req.params.id), orgId);
    res.json({ ok: true });
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/monitors/:id/resume", canAdmin, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    await resumeMonitor(String(req.params.id), orgId);
    res.json({ ok: true });
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

function isSlaDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type SlaReq = import("express").Request & { orgId?: string; orgDb?: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
const slaOrg = (req: import("express").Request) => (req as SlaReq).orgId ?? "default";
/** Requetes SLA : transaction RLS de l'organisation, et filtre `org_id` ecrit a la main en plus. */
const slaDb = (req: import("express").Request) => {
  const r = req as SlaReq;
  return r.orgDb ? r.orgDb.bind(r) : pool.query.bind(pool) as unknown as NonNullable<SlaReq["orgDb"]>;
};
async function loadSlaTarget(req: import("express").Request, monitorId: string): Promise<number | null> {
  const r = await slaDb(req)(`SELECT target_pct FROM sla_targets WHERE org_id = $1 AND monitor_id = $2`, [slaOrg(req), monitorId]);
  return parseSlaTarget(r.rows[0]?.["target_pct"] === undefined ? null : String(r.rows[0]?.["target_pct"]));
}

/** Valide la periode ; rend la reponse 400 deja envoyee, ou la periode. */
function slaRange(req: import("express").Request, res: import("express").Response): { from?: string; to?: string } | null {
  const { from, to } = req.query as Record<string, unknown>;
  if ((from !== undefined && !isSlaDate(from)) || (to !== undefined && !isSlaDate(to))) {
    res.status(400).json({ error: "from et to doivent être des dates valides au format AAAA-MM-JJ.", code: "INVALID_SLA_RANGE" });
    return null;
  }
  if (typeof from === "string" && typeof to === "string" && from > to) {
    res.status(400).json({ error: "La date from doit être antérieure ou égale à la date to.", code: "INVALID_SLA_RANGE" });
    return null;
  }
  return { from: from as string | undefined, to: to as string | undefined };
}

router.get("/betterstack/monitors/:id/sla", requireAddon("slaMonitoring", "SLA Monitoring Avancé"), async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const range = slaRange(req, res);
    if (!range) return;
    const monitorId = String(req.params.id);
    const data = await getMonitorSLA(monitorId, slaOrg(req), range.from, range.to);
    // La cible est facultative : si sa lecture echoue, la mesure reste servie, sans conformite.
    let target: number | null = null;
    let compliance: ReturnType<typeof evaluateSla> | null = null;
    try { target = await loadSlaTarget(req, monitorId); compliance = evaluateSla(extractAvailability(data), target); }
    catch (err) { logger.warn({ err: (err as Error)?.name }, "[SLA] target lookup failed — compliance omitted"); }
    res.json({ ...(data as object), compliance });
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
    // croire a une panne alors que l'acces est simplement refuse.
    res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/monitors/:id/sla/export.csv", requireAddon("slaMonitoring", "SLA Monitoring Avancé"), async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const range = slaRange(req, res);
    if (!range) return;
    const monitorId = String(req.params.id);
    const data = await getMonitorSLA(monitorId, slaOrg(req), range.from, range.to);
    const compliance = evaluateSla(extractAvailability(data), await loadSlaTarget(req, monitorId));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="sla-report.csv"');
    res.setHeader("Cache-Control", "no-store");
    res.send(slaReportCsv({ monitorId, from: range.from, to: range.to, report: data, compliance }));
  } catch (err) {
    res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/sla-targets", requireAddon("slaMonitoring", "SLA Monitoring Avancé"), async (req, res) => {
  try {
    const r = await slaDb(req)(`SELECT monitor_id, target_pct FROM sla_targets WHERE org_id = $1 ORDER BY monitor_id LIMIT 500`, [slaOrg(req)]);
    res.json({ targets: r.rows.map(row => ({ monitorId: String(row["monitor_id"]), targetPct: Number(row["target_pct"]) })) });
  } catch { res.status(500).json({ error: "Unable to load SLA targets.", code: "SLA_TARGETS_UNAVAILABLE" }); }
});

router.put("/betterstack/monitors/:id/sla-target", canAdmin, requireAddon("slaMonitoring", "SLA Monitoring Avancé"), async (req, res) => {
  const target = parseSlaTarget((req.body as { targetPct?: unknown } | undefined)?.targetPct);
  if (target === null) {
    res.status(400).json({ error: `The target must be a percentage between ${SLA_TARGET_MIN} and ${SLA_TARGET_MAX}.`, code: "INVALID_SLA_TARGET" });
    return;
  }
  try {
    const monitorId = String(req.params.id);
    await exigerAppartenance(monitorId, slaOrg(req));
    const who = String((req as { orgContext?: { userId?: string; email?: string } }).orgContext?.userId ?? (req as { orgContext?: { email?: string } }).orgContext?.email ?? "");
    await slaDb(req)(
      `INSERT INTO sla_targets (org_id, monitor_id, target_pct, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, monitor_id) DO UPDATE SET target_pct = EXCLUDED.target_pct, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [slaOrg(req), monitorId, target, who || null]);
    res.json({ ok: true, monitorId, targetPct: target });
  } catch (err) {
    res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.delete("/betterstack/monitors/:id/sla-target", canAdmin, requireAddon("slaMonitoring", "SLA Monitoring Avancé"), async (req, res) => {
  try {
    await slaDb(req)(`DELETE FROM sla_targets WHERE org_id = $1 AND monitor_id = $2`, [slaOrg(req), String(req.params.id)]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to remove the SLA target.", code: "SLA_TARGETS_UNAVAILABLE" }); }
});

router.get("/betterstack/monitors/:id/response-times", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const period = (req.query["period"] as string) || "24h";
    const data = await getResponseTimes(req.params.id, period);
    res.json(data);
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
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
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.get("/betterstack/incidents/:id", async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const incident = await getIncident(req.params.id);
    res.json(incident);
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/incidents/:id/acknowledge", canWrite, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    await acknowledgeIncident(String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
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
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/heartbeats", canAdmin, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const { name, period, grace, email } = req.body as { name?: string; period?: number; grace?: number; email?: string };
    if (!name || !period) { res.status(400).json({ error: "name and period required" }); return; }
    const hb = await createHeartbeat(orgId, { name, period, grace, email });
    res.status(201).json(hb);
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
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
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

router.post("/betterstack/status-pages", canAdmin, async (req, res) => {
  if (!isBSConfigured()) { res.status(503).json({ error: "Not configured", configured: false }); return; }
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const { name, subdomain, custom_domain } = req.body as { name?: string; subdomain?: string; custom_domain?: string };
    if (!name || !subdomain) { res.status(400).json({ error: "name and subdomain required" }); return; }
    const page = await createStatusPage(orgId, { name, subdomain, custom_domain });
    res.status(201).json(page);
  } catch (err) {
    // Une erreur d'appartenance porte son propre statut : repondre 500 laisserait
      // croire a une panne alors que l'acces est simplement refuse.
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: safeErrMsg(err) });
  }
});

export default router;
