import { Router, type Request } from "express";
import { store } from "../services/store.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

const VALID_TYPES    = ["seo_score", "latency", "uptime", "monitor_down", "keyword_ranking_drop"];
const VALID_OPS      = ["lt", "gt", "eq"];
const VALID_CHANNELS = ["email", "sms"];

const DEFAULT_TEMPLATES = [
  { name: "Monitor DOWN",                   type: "monitor_down",          operator: "eq", threshold: 1,    durationMin: 0,  channels: ["email"],          siteUrls: [] },
  { name: "Score SEO critique (< 50)",      type: "seo_score",             operator: "lt", threshold: 50,   durationMin: 0,  channels: ["email"],          siteUrls: [] },
  { name: "Chute ranking mot-clé (> 5 pos)",type: "keyword_ranking_drop",  operator: "gt", threshold: 5,    durationMin: 0,  channels: ["email"],          siteUrls: [] },
  { name: "Latence élevée (> 1s)",          type: "latency",               operator: "gt", threshold: 1000, durationMin: 5,  channels: ["email"],          siteUrls: [] },
  { name: "Uptime faible (< 98%)",          type: "uptime",                operator: "lt", threshold: 98,   durationMin: 10, channels: ["email", "sms"],   siteUrls: [] },
];

// ── GET /alert-rules ──────────────────────────────────────────────────────────
router.get("/alert-rules", async (req, res) => {
  try {
    const r = await db(req)(`SELECT * FROM alert_rules WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`, [org(req)]);
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

// ── GET /alert-rules/:id ──────────────────────────────────────────────────────
router.get("/alert-rules/:id", async (req, res) => {
  try {
    const r = await db(req)(`SELECT * FROM alert_rules WHERE id=$1 AND org_id=$2 LIMIT 1`, [req.params.id, org(req)]);
    if (!r.rows[0]) { res.status(404).json({ error: "Alert rule not found" }); return; }
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Failed to fetch alert rule" }); }
});

// ── POST /alert-rules ─────────────────────────────────────────────────────────
router.post("/alert-rules", async (req, res) => {
  const { name, type, operator, threshold, durationMin, channels, siteUrls, enabled } = req.body as {
    name?: string; type?: string; operator?: string; threshold?: number;
    durationMin?: number; channels?: string[]; siteUrls?: string[]; enabled?: boolean;
  };
  if (!name || !type || !operator || threshold === undefined) {
    res.status(400).json({ error: "name, type, operator, threshold required" }); return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: "type must be seo_score|latency|uptime|monitor_down|keyword_ranking_drop" }); return;
  }
  if (!VALID_OPS.includes(operator)) {
    res.status(400).json({ error: "operator must be lt|gt|eq" }); return;
  }

  const id = `ar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO alert_rules (id, org_id, name, type, operator, threshold, duration_min, channels, site_urls, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, org(req), name, type, operator, Number(threshold), Number(durationMin ?? 0),
       JSON.stringify(channels ?? ["email"]), JSON.stringify(siteUrls ?? []), enabled ?? true]
    );
    const r = await db(req)(`SELECT * FROM alert_rules WHERE id=$1`, [id]);
    res.status(201).json(r.rows[0] ?? { id });
  } catch {
    res.status(500).json({ error: "Failed to create alert rule" });
  }
});

// ── GET /alert-rules/templates ────────────────────────────────────────────────
router.get("/alert-rules/templates", (_req, res) => {
  res.json(DEFAULT_TEMPLATES);
});

// ── PATCH /alert-rules/mark-all-read ─────────────────────────────────────────
router.patch("/alert-rules/mark-all-read", async (req, res) => {
  try {
    await db(req)(`UPDATE alert_events SET read_at=NOW() WHERE read_at IS NULL AND org_id=$1`, [org(req)]);
    if (Array.isArray(store.triggeredAlerts)) store.triggeredAlerts = [];
    res.json({ ok: true });
  } catch {
    if (Array.isArray(store.triggeredAlerts)) store.triggeredAlerts = [];
    res.json({ ok: true });
  }
});

// ── PATCH /alert-rules/:id ────────────────────────────────────────────────────
router.patch("/alert-rules/:id", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  if (body.type !== undefined && !VALID_TYPES.includes(body.type as string)) {
    res.status(400).json({ error: "type invalide" }); return;
  }
  if (body.operator !== undefined && !VALID_OPS.includes(body.operator as string)) {
    res.status(400).json({ error: "operator must be lt|gt|eq" }); return;
  }
  if (body.threshold !== undefined && isNaN(Number(body.threshold))) {
    res.status(400).json({ error: "threshold must be a number" }); return;
  }
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels) || (body.channels as string[]).some(c => !VALID_CHANNELS.includes(c))) {
      res.status(400).json({ error: "channels must be array of email|sms" }); return;
    }
  }
  if (body.siteUrls !== undefined && !Array.isArray(body.siteUrls)) {
    res.status(400).json({ error: "siteUrls must be an array" }); return;
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined)      { params.push(body.name);                             setClauses.push(`name=$${params.length}`); }
  if (body.type !== undefined)      { params.push(body.type);                             setClauses.push(`type=$${params.length}`); }
  if (body.operator !== undefined)  { params.push(body.operator);                        setClauses.push(`operator=$${params.length}`); }
  if (body.threshold !== undefined) { params.push(Number(body.threshold));               setClauses.push(`threshold=$${params.length}`); }
  if (body.durationMin !== undefined){ params.push(Number(body.durationMin));            setClauses.push(`duration_min=$${params.length}`); }
  if (body.channels !== undefined)  { params.push(JSON.stringify(body.channels));        setClauses.push(`channels=$${params.length}`); }
  if (body.siteUrls !== undefined)  { params.push(JSON.stringify(body.siteUrls));        setClauses.push(`site_urls=$${params.length}`); }
  if (body.enabled !== undefined)   { params.push(body.enabled);                         setClauses.push(`enabled=$${params.length}`); }

  if (setClauses.length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }

  params.push(req.params.id, org(req));
  try {
    const r = await db(req)(
      `UPDATE alert_rules SET ${setClauses.join(",")} WHERE id=$${params.length - 1} AND org_id=$${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) { res.status(404).json({ error: "not found" }); return; }
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update alert rule" });
  }
});

// ── DELETE /alert-rules/:id ───────────────────────────────────────────────────
router.delete("/alert-rules/:id", async (req, res) => {
  try {
    await db(req)(`DELETE FROM alert_rules WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete alert rule" });
  }
});

// ── GET /alert-events ─────────────────────────────────────────────────────────
router.get("/alert-events", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT id, rule_id, rule_name, type, metric_value, threshold, operator,
              severity, message, site_url, read_at, resolved_at, triggered_at
       FROM alert_events WHERE org_id=$1 ORDER BY triggered_at DESC LIMIT 200`,
      [org(req)]
    );
    res.json(r.rows.map(row => ({
      id:          row.id,
      ruleId:      row.rule_id,
      ruleName:    row.rule_name,
      type:        row.type,
      metricValue: row.metric_value,
      threshold:   row.threshold,
      operator:    row.operator,
      severity:    row.severity,
      message:     row.message,
      siteUrl:     row.site_url,
      readAt:      row.read_at,
      resolvedAt:  row.resolved_at,
      triggeredAt: row.triggered_at,
    })));
  } catch {
    res.json(store.triggeredAlerts);
  }
});

// ── POST /alert-events ────────────────────────────────────────────────────────
router.post("/alert-events", async (req, res) => {
  const { ruleId, ruleName, type, metricValue, threshold, operator, severity, message, siteUrl } = req.body as {
    ruleId?: string; ruleName?: string; type?: string; metricValue?: number;
    threshold?: number; operator?: string; severity?: string; message?: string; siteUrl?: string;
  };
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO alert_events (id, org_id, rule_id, rule_name, type, metric_value, threshold, operator, severity, message, site_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, org(req), ruleId ?? "", ruleName ?? "", type ?? "seo_score", metricValue ?? null, threshold ?? null,
       operator ?? "lt", severity ?? "warning", message ?? "", siteUrl ?? ""]
    );
    res.status(201).json({ id, triggeredAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to create alert event" });
  }
});

// ── GET /alerts (alias) ───────────────────────────────────────────────────────
router.get("/alerts", async (req, res) => {
  try {
    const r = await db(req)(`SELECT * FROM alert_events WHERE org_id=$1 ORDER BY triggered_at DESC LIMIT 50`, [org(req)]);
    res.json(r.rows);
  } catch {
    res.json(store.triggeredAlerts);
  }
});

export default router;
