import { Router } from "express";
import { db, monitorsTable, monitorChecksTable } from "@workspace/db";
import { eq, desc, gte, and } from "drizzle-orm";
import { store } from "../services/store.js";
import { validateMonitorUrl } from "../lib/validateMonitorUrl.js";

const router = Router();
const E164_RE = /^\+[1-9]\d{7,14}$/;

const ALLOWED_ALERT_EMAIL = process.env["ALERT_EMAIL"] || "";
const ALLOWED_ALERT_PHONE = process.env["ALERT_PHONE"] || "";

function validateAlertEmail(email: string | undefined): string | null {
  if (!email) return null;
  if (!ALLOWED_ALERT_EMAIL) {
    return "alertEmail cannot be set: no ALERT_EMAIL is configured on this server";
  }
  if (email !== ALLOWED_ALERT_EMAIL) {
    return "alertEmail must match the account-configured alert address";
  }
  return null;
}

function validateAlertPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  if (!E164_RE.test(phone)) {
    return "alertPhone must be in E.164 format (e.g. +33612345678)";
  }
  if (!ALLOWED_ALERT_PHONE) {
    return "alertPhone cannot be set: no ALERT_PHONE is configured on this server";
  }
  if (phone !== ALLOWED_ALERT_PHONE) {
    return "alertPhone must match the account-configured alert phone number";
  }
  return null;
}

router.get("/monitors", async (_req, res) => {
  const monitors = await db.select().from(monitorsTable);
  res.json(monitors);
});

router.get("/monitors/:id/checks-summary", async (req, res) => {
  const { id } = req.params;
  const now = Date.now();
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const checks = await db
    .select()
    .from(monitorChecksTable)
    .where(and(eq(monitorChecksTable.monitorId, id), gte(monitorChecksTable.checkedAt, since)));

  const dayMap: Record<string, { ok: number; total: number }> = {};
  for (const check of checks) {
    const d = new Date(check.checkedAt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (!dayMap[key]) dayMap[key] = { ok: 0, total: 0 };
    dayMap[key].total++;
    if (check.ok) dayMap[key].ok++;
  }

  const days: { date: string; ok: number; total: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    days.push({ date: key, ok: dayMap[key]?.ok ?? 0, total: dayMap[key]?.total ?? 0 });
  }

  res.json(days);
});

router.get("/monitors/:id/checks", async (req, res) => {
  const { id } = req.params;
  const days = Math.min(Number(req.query["days"] ?? 30), 90);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const checks = await db
    .select()
    .from(monitorChecksTable)
    .where(and(eq(monitorChecksTable.monitorId, id), gte(monitorChecksTable.checkedAt, since)))
    .orderBy(desc(monitorChecksTable.checkedAt))
    .limit(10000);
  res.json(checks);
});

router.post("/monitors", async (req, res) => {
  const { url, name, alertEmail, alertPhone, isCritical, frequency } = req.body as {
    url?: string;
    name?: string;
    alertEmail?: string;
    alertPhone?: string;
    isCritical?: boolean;
    frequency?: string;
  };
  if (!url || !name) { res.status(400).json({ error: "url and name required" }); return; }

  const urlError = await validateMonitorUrl(url);
  if (urlError) { res.status(400).json({ error: urlError }); return; }

  const emailError = validateAlertEmail(alertEmail);
  if (emailError) { res.status(400).json({ error: emailError }); return; }

  const phoneError = validateAlertPhone(alertPhone);
  if (phoneError) { res.status(400).json({ error: phoneError }); return; }
  const [monitor] = await db.insert(monitorsTable).values({
    id: `m${Date.now()}`,
    name,
    url,
    status: "up",
    uptime: 100,
    latency: Math.floor(Math.random() * 200) + 50,
    lastCheck: "à l'instant",
    alertEmail: alertEmail || "",
    alertPhone: alertPhone || "",
    isCritical: isCritical ?? false,
    frequency: frequency || "5min",
    lastAlertSent: null,
  }).returning();
  store.logActivity({
    type: "monitor",
    label: `Monitor créé : ${name} (${url})`,
    targetId: monitor.id,
    targetType: "monitor",
    metadata: { url, name },
  }).catch(() => {});
  res.status(201).json(monitor);
});

router.patch("/monitors/:id", async (req, res) => {
  const { id } = req.params;
  const body = req.body as {
    name?: string;
    url?: string;
    status?: string;
    uptime?: number;
    latency?: number;
    lastCheck?: string;
    alertEmail?: string;
    alertPhone?: string;
    isCritical?: boolean;
    frequency?: string;
    lastAlertSent?: number | null;
  };

  if (body.url !== undefined) {
    const urlError = await validateMonitorUrl(body.url);
    if (urlError) { res.status(400).json({ error: urlError }); return; }
  }

  if (body.alertEmail !== undefined && body.alertEmail !== "") {
    const emailError = validateAlertEmail(body.alertEmail);
    if (emailError) { res.status(400).json({ error: emailError }); return; }
  }

  if (body.alertPhone !== undefined && body.alertPhone !== "") {
    const phoneError = validateAlertPhone(body.alertPhone);
    if (phoneError) { res.status(400).json({ error: phoneError }); return; }
  }

  const updates: Partial<typeof body> = {};
  if (body.name !== undefined)        updates.name = body.name;
  if (body.url !== undefined)         updates.url = body.url;
  if (body.status !== undefined)      updates.status = body.status;
  if (body.uptime !== undefined)      updates.uptime = body.uptime;
  if (body.latency !== undefined)     updates.latency = body.latency;
  if (body.lastCheck !== undefined)   updates.lastCheck = body.lastCheck;
  if (body.alertEmail !== undefined)  updates.alertEmail = body.alertEmail;
  if (body.alertPhone !== undefined)  updates.alertPhone = body.alertPhone;
  if (body.isCritical !== undefined)  updates.isCritical = body.isCritical;
  if (body.frequency !== undefined)   updates.frequency = body.frequency;
  if (body.lastAlertSent !== undefined) updates.lastAlertSent = body.lastAlertSent;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db.update(monitorsTable)
    .set(updates)
    .where(eq(monitorsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "not found" }); return; }
  res.json(updated);
});

router.post("/monitors/:id/ping", async (req, res) => {
  const [monitor] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, req.params.id));
  if (!monitor) { res.status(404).json({ error: "Monitor not found" }); return; }

  const start = Date.now();
  let ok = false;
  let statusCode = 0;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(monitor.url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timeout);
    statusCode = resp.status;
    ok = resp.ok;
  } catch {
    ok = false;
  }
  const responseTime = Date.now() - start;
  const newStatus = ok ? "up" : "down";

  const [updated] = await db.update(monitorsTable)
    .set({ status: newStatus, responseTime, lastChecked: new Date().toISOString() })
    .where(eq(monitorsTable.id, req.params.id))
    .returning();

  store.logActivity({
    type: "monitor",
    label: `Ping ${monitor.name} — ${newStatus.toUpperCase()} (${responseTime}ms)`,
    targetId: req.params.id,
    targetType: "monitor",
    metadata: { url: monitor.url, responseTime, status: newStatus },
  }).catch(() => {});

  store.broadcast({ type: "monitor:ping", monitorId: req.params.id, status: newStatus, responseTime });

  res.json({ ok: true, status: newStatus, responseTime, statusCode, monitor: updated });
});

router.delete("/monitors/:id", async (req, res) => {
  const [existing] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, req.params.id));
  await db.delete(monitorsTable).where(eq(monitorsTable.id, req.params.id));
  if (existing) {
    store.logActivity({
      type: "monitor",
      label: `Monitor supprimé : ${existing.name} (${existing.url})`,
      targetId: req.params.id,
      targetType: "monitor",
      metadata: { url: existing.url, name: existing.name },
    }).catch(() => {});
  }
  res.json({ ok: true });
});

export default router;
