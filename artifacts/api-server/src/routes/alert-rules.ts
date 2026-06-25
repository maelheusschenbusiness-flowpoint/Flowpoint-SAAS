import { Router } from "express";
import { db, alertRulesTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";

const router = Router();

router.get("/alert-rules", async (_req, res) => {
  try {
    const rules = await db.select().from(alertRulesTable).limit(200);
    res.json(rules);
  } catch {
    res.json([]);
  }
});

router.post("/alert-rules", async (req, res) => {
  const { name, type, operator, threshold, durationMin, channels, siteUrls, enabled } = req.body as {
    name?: string;
    type?: string;
    operator?: string;
    threshold?: number;
    durationMin?: number;
    channels?: string[];
    siteUrls?: string[];
    enabled?: boolean;
  };
  if (!name || !type || !operator || threshold === undefined) {
    res.status(400).json({ error: "name, type, operator, threshold required" });
    return;
  }
  if (!["seo_score", "latency", "uptime", "monitor_down", "keyword_ranking_drop"].includes(type)) {
    res.status(400).json({ error: "type must be seo_score|latency|uptime|monitor_down|keyword_ranking_drop" }); return;
  }
  const validOps = ["lt", "gt", "eq"];
  if (!validOps.includes(operator)) { res.status(400).json({ error: "operator must be lt|gt|eq" }); return; }

  try {
    const [rule] = await db.insert(alertRulesTable).values({
      id: `ar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      type,
      operator,
      threshold: Number(threshold),
      durationMin: Number(durationMin ?? 0),
      channels: JSON.stringify(channels ?? ["email"]),
      siteUrls: JSON.stringify(siteUrls ?? []),
      enabled: enabled ?? true,
    }).returning();
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: "Failed to create alert rule" });
  }
});

const VALID_TYPES = ["seo_score", "latency", "uptime", "monitor_down", "keyword_ranking_drop"];
const VALID_OPS = ["lt", "gt", "eq"];
const VALID_CHANNELS = ["email", "sms"];

const DEFAULT_TEMPLATES = [
  { name: "Monitor DOWN", type: "monitor_down", operator: "eq", threshold: 1, durationMin: 0, channels: ["email"], siteUrls: [] },
  { name: "Score SEO critique (< 50)", type: "seo_score", operator: "lt", threshold: 50, durationMin: 0, channels: ["email"], siteUrls: [] },
  { name: "Chute ranking mot-clé (> 5 pos)", type: "keyword_ranking_drop", operator: "gt", threshold: 5, durationMin: 0, channels: ["email"], siteUrls: [] },
  { name: "Latence élevée (> 1s)", type: "latency", operator: "gt", threshold: 1000, durationMin: 5, channels: ["email"], siteUrls: [] },
  { name: "Uptime faible (< 98%)", type: "uptime", operator: "lt", threshold: 98, durationMin: 10, channels: ["email", "sms"], siteUrls: [] },
];

router.patch("/alert-rules/mark-all-read", async (_req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query(`UPDATE alert_events SET read_at = NOW() WHERE read_at IS NULL`);
    if (Array.isArray(store.triggeredAlerts)) store.triggeredAlerts = [];
    res.json({ ok: true });
  } catch {
    if (Array.isArray(store.triggeredAlerts)) store.triggeredAlerts = [];
    res.json({ ok: true });
  } finally {
    if (client) client.release();
  }
});

router.patch("/alert-rules/:id", async (req, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;

  // Validate provided fields (same constraints as POST)
  if (body.type !== undefined && !VALID_TYPES.includes(body.type as string)) {
    res.status(400).json({ error: "type must be seo_score|latency|uptime" }); return;
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
    res.status(400).json({ error: "siteUrls must be an array of strings" }); return;
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.operator !== undefined) updates.operator = body.operator;
  if (body.threshold !== undefined) updates.threshold = Number(body.threshold);
  if (body.durationMin !== undefined) updates.durationMin = Number(body.durationMin);
  if (body.channels !== undefined) updates.channels = JSON.stringify(body.channels);
  if (body.siteUrls !== undefined) updates.siteUrls = JSON.stringify(body.siteUrls);
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }

  try {
    const [updated] = await db.update(alertRulesTable)
      .set(updates)
      .where(eq(alertRulesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update alert rule" });
  }
});

router.get("/alert-rules/templates", (_req, res) => {
  res.json(DEFAULT_TEMPLATES);
});

router.delete("/alert-rules/:id", async (req, res) => {
  try {
    await db.delete(alertRulesTable).where(eq(alertRulesTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete alert rule" });
  }
});

// ── Alert events — DB-persisted ──────────────────────────────────────────────

router.get("/alert-events", async (_req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id, rule_id, rule_name, type, metric_value, threshold, operator,
              severity, message, site_url, read_at, resolved_at, triggered_at
       FROM alert_events
       ORDER BY triggered_at DESC
       LIMIT 200`
    );
    res.json(r.rows.map((row) => ({
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
  } finally {
    client.release();
  }
});

router.post("/alert-events", async (req, res) => {
  const { ruleId, ruleName, type, metricValue, threshold, operator, severity, message, siteUrl } = req.body as {
    ruleId?: string; ruleName?: string; type?: string; metricValue?: number;
    threshold?: number; operator?: string; severity?: string; message?: string; siteUrl?: string;
  };
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO alert_events (id, rule_id, rule_name, type, metric_value, threshold, operator, severity, message, site_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, ruleId||"", ruleName||"", type||"seo_score", metricValue??null, threshold??null,
       operator||"lt", severity||"warning", message||"", siteUrl||""]
    );
    res.status(201).json({ id, triggeredAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to create alert event" });
  } finally {
    client.release();
  }
});

router.get("/alerts", async (_req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM alert_events ORDER BY triggered_at DESC LIMIT 50`);
    res.json(r.rows);
  } catch {
    res.json(store.triggeredAlerts);
  } finally {
    client.release();
  }
});

export default router;
