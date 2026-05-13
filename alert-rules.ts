import { Router } from "express";
import { db, alertRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";

const router = Router();

router.get("/alert-rules", async (_req, res) => {
  try {
    const rules = await db.select().from(alertRulesTable);
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch alert rules" });
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
  const validTypes = ["seo_score", "latency", "uptime"];
  const validOps = ["lt", "gt", "eq"];
  if (!validTypes.includes(type)) { res.status(400).json({ error: "type must be seo_score|latency|uptime" }); return; }
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

const VALID_TYPES = ["seo_score", "latency", "uptime"];
const VALID_OPS = ["lt", "gt", "eq"];
const VALID_CHANNELS = ["email", "sms"];

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

router.delete("/alert-rules/:id", async (req, res) => {
  try {
    await db.delete(alertRulesTable).where(eq(alertRulesTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete alert rule" });
  }
});

router.get("/alert-events", (_req, res) => {
  res.json(store.triggeredAlerts);
});

export default router;
