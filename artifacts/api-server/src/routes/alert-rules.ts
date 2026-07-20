import { Router, type Request } from "express";
import { store } from "../services/store.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { canWrite, canAdmin } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// Event-based types fire on state transition — operator/threshold are not applicable
const EVENT_TYPES    = ["monitor_down", "monitor_up"];
const THRESHOLD_TYPES = ["seo_score", "latency", "uptime", "keyword_ranking_drop"];
const VALID_TYPES    = [...EVENT_TYPES, ...THRESHOLD_TYPES];
const VALID_OPS      = ["lt", "lte", "gt", "gte", "eq"];
const VALID_CHANNELS = ["email", "sms"];

const DEFAULT_TEMPLATES = [
  { name: "Monitor DOWN",                   type: "monitor_down",          durationMin: 0,  channels: ["email"],          siteUrls: [] },
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

// ── GET /alert-rules/templates ────────────────────────────────────────────────
// Must be BEFORE /:id so Express doesn't consume "templates" as a dynamic param
router.get("/alert-rules/templates", (_req, res) => {
  res.json(DEFAULT_TEMPLATES);
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
router.post("/alert-rules", canWrite, async (req, res) => {
  const { name, type, operator, threshold, durationMin, channels, siteUrls, enabled } = req.body as {
    name?: string; type?: string; operator?: string; threshold?: number;
    durationMin?: number; channels?: string[]; siteUrls?: string[]; enabled?: boolean;
  };

  if (!name || !type) {
    res.status(400).json({ error: "name et type sont obligatoires" }); return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: "type invalide — valeurs autorisées : " + VALID_TYPES.join("|") }); return;
  }

  const isEvent = EVENT_TYPES.includes(type);

  if (!isEvent) {
    // Threshold-based rules require operator + threshold
    if (!operator) {
      res.status(400).json({ error: "operator est obligatoire pour ce type de règle" }); return;
    }
    if (!VALID_OPS.includes(operator)) {
      res.status(400).json({ error: "operator invalide — valeurs autorisées : " + VALID_OPS.join("|") }); return;
    }
    if (threshold === undefined || threshold === null || !isFinite(Number(threshold))) {
      res.status(400).json({ error: "threshold doit être un nombre fini" }); return;
    }
    // Business range validation
    if (type === "seo_score" && (Number(threshold) < 0 || Number(threshold) > 100)) {
      res.status(400).json({ error: "threshold pour seo_score doit être compris entre 0 et 100" }); return;
    }
    if (type === "uptime" && (Number(threshold) < 0 || Number(threshold) > 100)) {
      res.status(400).json({ error: "threshold pour uptime doit être compris entre 0 et 100" }); return;
    }
    if (type === "latency" && Number(threshold) < 0) {
      res.status(400).json({ error: "threshold pour latency doit être >= 0" }); return;
    }
  }

  // For event-based types, operator and threshold are semantically inapplicable → store NULL
  const finalOperator  = isEvent ? null : operator!;
  const finalThreshold = isEvent ? null : Number(threshold);

  const id = `ar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO alert_rules (id, org_id, name, type, operator, threshold, duration_min, channels, site_urls, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, org(req), name, type, finalOperator, finalThreshold, Number(durationMin ?? 0),
       JSON.stringify(channels ?? ["email"]), JSON.stringify(siteUrls ?? []), enabled ?? true]
    );
    const r = await db(req)(`SELECT * FROM alert_rules WHERE id=$1`, [id]);
    res.status(201).json(r.rows[0] ?? { id });
  } catch {
    res.status(500).json({ error: "Failed to create alert rule" });
  }
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
router.patch("/alert-rules/:id", canWrite, async (req, res) => {
  const body = req.body as Record<string, unknown>;

  if (body.type !== undefined && !VALID_TYPES.includes(body.type as string)) {
    res.status(400).json({ error: "type invalide" }); return;
  }

  // Determine whether the rule being updated is event-based
  // If body.type is provided, use it; otherwise we must trust the client is consistent
  const newType = body.type as string | undefined;
  const isEventType = newType !== undefined && EVENT_TYPES.includes(newType);

  if (!isEventType) {
    // Only validate operator/threshold for threshold-based rules
    if (body.operator !== undefined && !VALID_OPS.includes(body.operator as string)) {
      res.status(400).json({ error: "operator invalide — valeurs autorisées : " + VALID_OPS.join("|") }); return;
    }
    if (body.threshold !== undefined && (!isFinite(Number(body.threshold)))) {
      res.status(400).json({ error: "threshold doit être un nombre fini" }); return;
    }
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
  if (body.name !== undefined)       { params.push(body.name);                      setClauses.push(`name=$${params.length}`); }
  if (body.type !== undefined)       { params.push(body.type);                      setClauses.push(`type=$${params.length}`); }
  if (body.durationMin !== undefined){ params.push(Number(body.durationMin));       setClauses.push(`duration_min=$${params.length}`); }
  if (body.channels !== undefined)   { params.push(JSON.stringify(body.channels));  setClauses.push(`channels=$${params.length}`); }
  if (body.siteUrls !== undefined)   { params.push(JSON.stringify(body.siteUrls)); setClauses.push(`site_urls=$${params.length}`); }
  if (body.enabled !== undefined)    { params.push(body.enabled);                   setClauses.push(`enabled=$${params.length}`); }

  // When switching to an event-based type, null out operator/threshold
  if (isEventType) {
    setClauses.push(`operator=NULL`);
    setClauses.push(`threshold=NULL`);
  } else {
    if (body.operator !== undefined)  { params.push(body.operator);                 setClauses.push(`operator=$${params.length}`); }
    if (body.threshold !== undefined) { params.push(Number(body.threshold));        setClauses.push(`threshold=$${params.length}`); }
  }

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
router.delete("/alert-rules/:id", canAdmin, async (req, res) => {
  try {
    await db(req)(`DELETE FROM alert_rules WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete alert rule" });
  }
});

// ── PATCH /alert-events/:id/resolve ──────────────────────────────────────────
// Must be before /alert-events GET to avoid Express consuming "resolve" as :id
router.patch("/alert-events/:id/resolve", async (req, res) => {
  try {
    await db(req)(
      `UPDATE alert_events SET status='resolved', resolved_at=NOW()
       WHERE id=$1 AND org_id=$2 AND status='open'`,
      [req.params.id, org(req)],
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to resolve alert event" });
  }
});

// ── GET /alert-events ─────────────────────────────────────────────────────────
router.get("/alert-events", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT id, rule_id, rule_name, type, metric_value, threshold, operator,
              severity, message, site_url, monitor_id, status,
              read_at, resolved_at, triggered_at
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
      monitorId:   row.monitor_id,
      status:      row.status ?? "open",
      readAt:      row.read_at,
      resolvedAt:  row.resolved_at,
      triggeredAt: row.triggered_at,
    })));
  } catch {
    res.json(store.triggeredAlerts);
  }
});

// ── POST /alert-events ────────────────────────────────────────────────────────
router.post("/alert-events", requireAdmin, async (req, res) => {
  const { ruleId, ruleName, type, metricValue, threshold, operator, severity, message, siteUrl, monitorId } = req.body as {
    ruleId?: string; ruleName?: string; type?: string; metricValue?: number;
    threshold?: number; operator?: string; severity?: string; message?: string;
    siteUrl?: string; monitorId?: string;
  };
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO alert_events
         (id, org_id, rule_id, rule_name, type, metric_value, threshold, operator,
          severity, message, site_url, monitor_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open')`,
      [id, org(req), ruleId ?? "", ruleName ?? "", type ?? "seo_score", metricValue ?? null, threshold ?? null,
       operator ?? null, severity ?? "warning", message ?? "", siteUrl ?? "", monitorId ?? ""]
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
