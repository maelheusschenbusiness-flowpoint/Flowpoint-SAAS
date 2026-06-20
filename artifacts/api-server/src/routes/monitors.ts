import { Router } from "express";
import { connectMongo } from "../lib/mongo.js";
import { MonitorModel, MonitorCheckModel } from "../models/Monitor.js";
import { store } from "../services/store.js";
import { validateMonitorUrl, isPrivateHost, checkDnsResolution } from "../lib/validateMonitorUrl.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();
const monitorCreateRateLimit = createRateLimit("reportsPerHour");
const E164_RE = /^\+[1-9]\d{7,14}$/;

const ALLOWED_ALERT_EMAIL = process.env["ALERT_EMAIL"] || "";
const ALLOWED_ALERT_PHONE = process.env["ALERT_PHONE"] || "";

function validateAlertEmail(email: string | undefined): string | null {
  if (!email) return null;
  if (!ALLOWED_ALERT_EMAIL) return "alertEmail cannot be set: no ALERT_EMAIL is configured on this server";
  if (email !== ALLOWED_ALERT_EMAIL) return "alertEmail must match the account-configured alert address";
  return null;
}

function validateAlertPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  if (!E164_RE.test(phone)) return "alertPhone must be in E.164 format (e.g. +33612345678)";
  if (!ALLOWED_ALERT_PHONE) return "alertPhone cannot be set: no ALERT_PHONE is configured on this server";
  if (phone !== ALLOWED_ALERT_PHONE) return "alertPhone must match the account-configured alert phone number";
  return null;
}

router.get("/monitors", async (_req, res) => {
  try {
    await connectMongo();
    const monitors = await MonitorModel.find().limit(500).lean({ virtuals: false });
    res.json(monitors.map(m => ({ ...m, id: m._id })));
  } catch (err) {
    logger.warn({ err }, "[monitors] GET failed");
    res.json([]);
  }
});

router.get("/monitors/:id/checks-summary", async (req, res) => {
  const { id } = req.params;
  try {
    await connectMongo();
    const now = Date.now();
    const since = now - 30 * 24 * 60 * 60 * 1000;
    const checks = await MonitorCheckModel.find({
      monitorId: id,
      checkedAt: { $gte: since },
    }).lean({ virtuals: false });

    const dayMap: Record<string, { ok: number; total: number }> = {};
    for (const check of checks) {
      const d = new Date(check.checkedAt as number);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      if (!dayMap[key]) dayMap[key] = { ok: 0, total: 0 };
      dayMap[key].total++;
      if (check.ok) dayMap[key].ok++;
    }

    const days: { date: string; ok: number; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      days.push({ date: key, ok: dayMap[key]?.ok ?? 0, total: dayMap[key]?.total ?? 0 });
    }
    res.json(days);
  } catch {
    res.json([]);
  }
});

router.get("/monitors/:id/checks", async (req, res) => {
  const { id } = req.params;
  try {
    await connectMongo();
    const days = Math.min(Number(req.query["days"] ?? 30), 90);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const checks = await MonitorCheckModel.find({
      monitorId: id,
      checkedAt: { $gte: since },
    }).sort({ checkedAt: -1 }).limit(10000).lean({ virtuals: false });
    res.json(checks.map(c => ({ ...c, id: c._id })));
  } catch {
    res.json([]);
  }
});

router.post("/monitors", monitorCreateRateLimit, async (req, res) => {
  const { url, name, alertEmail, alertPhone, isCritical, frequency } = req.body as {
    url?: string; name?: string; alertEmail?: string; alertPhone?: string;
    isCritical?: boolean; frequency?: string;
  };
  if (!url || !name) { res.status(400).json({ error: "url and name required" }); return; }

  const urlError = await validateMonitorUrl(url);
  if (urlError) { res.status(400).json({ error: urlError }); return; }

  const emailError = validateAlertEmail(alertEmail);
  if (emailError) { res.status(400).json({ error: emailError }); return; }

  const phoneError = validateAlertPhone(alertPhone);
  if (phoneError) { res.status(400).json({ error: phoneError }); return; }

  try {
    await connectMongo();
    const id = `m${Date.now()}`;
    const monitor = await MonitorModel.create({
      _id: id, name, url, status: "up", uptime: 100, latency: 0,
      lastCheck: "à l'instant", alertEmail: alertEmail || "",
      alertPhone: alertPhone || "", isCritical: isCritical ?? false,
      frequency: frequency || "5min", lastAlertSent: null,
    });
    const doc = monitor.toJSON();
    store.logActivity({
      type: "monitor", label: `Monitor créé : ${name} (${url})`,
      targetId: id, targetType: "monitor", metadata: { url, name },
    }).catch(() => {});
    res.status(201).json(doc);
  } catch (err) {
    logger.error({ err }, "[monitors] POST failed");
    res.status(500).json({ error: "Failed to create monitor" });
  }
});

router.patch("/monitors/:id", async (req, res) => {
  const { id } = req.params;
  const body = req.body as {
    name?: string; url?: string; status?: string; uptime?: number;
    latency?: number; lastCheck?: string; alertEmail?: string;
    alertPhone?: string; isCritical?: boolean; frequency?: string;
    lastAlertSent?: number | null; responseTime?: number; lastChecked?: string;
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

  const updates: Record<string, unknown> = {};
  const fields = ["name","url","status","uptime","latency","lastCheck","alertEmail",
                  "alertPhone","isCritical","frequency","lastAlertSent","responseTime","lastChecked"] as const;
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }

  try {
    await connectMongo();
    const updated = await MonitorModel.findByIdAndUpdate(id, { $set: updates }, { new: true, lean: true });
    if (!updated) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ...updated, id: updated._id });
  } catch (err) {
    logger.error({ err }, "[monitors] PATCH failed");
    res.status(500).json({ error: "Update failed" });
  }
});

router.post("/monitors/:id/ping", async (req, res) => {
  try {
    await connectMongo();
    const monitor = await MonitorModel.findById(req.params.id).lean();
    if (!monitor) { res.status(404).json({ error: "Monitor not found" }); return; }

    const start = Date.now();
    let ok = false;
    let statusCode = 0;

    let initialParsed: URL | null = null;
    try { initialParsed = new URL(monitor.url as string); } catch { /* ignore */ }

    const pingBlocked =
      !initialParsed ||
      (initialParsed.protocol !== "http:" && initialParsed.protocol !== "https:") ||
      isPrivateHost(initialParsed.hostname) ||
      (await checkDnsResolution(initialParsed.hostname)) !== null;

    if (!pingBlocked) {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 8000);
        const MAX_REDIRECTS = 5;
        let currentUrl = monitor.url as string;
        let done = false;

        for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
          const resp = await fetch(currentUrl, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
          if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get("location");
            if (!location) break;
            let redirectTarget: URL;
            try { redirectTarget = new URL(location, currentUrl); } catch { break; }
            if (redirectTarget.protocol !== "http:" && redirectTarget.protocol !== "https:") break;
            if (isPrivateHost(redirectTarget.hostname)) break;
            if ((await checkDnsResolution(redirectTarget.hostname)) !== null) break;
            currentUrl = redirectTarget.toString();
            continue;
          }
          statusCode = resp.status;
          ok = resp.ok || resp.status < 400;
          done = true;
          break;
        }
        clearTimeout(timeout);
        if (!done) ok = false;
      } catch { ok = false; }
    }

    const responseTime = Date.now() - start;
    const newStatus = ok ? "up" : "down";
    const now = new Date().toISOString();

    const updated = await MonitorModel.findByIdAndUpdate(
      req.params.id,
      { $set: { status: newStatus, responseTime, lastChecked: now } },
      { new: true, lean: true },
    );

    // Store check record in MongoDB
    const checkId = `chk${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    MonitorCheckModel.create({
      _id: checkId, monitorId: req.params.id,
      ok, statusCode, responseTime, checkedAt: Date.now(),
    }).catch(() => {});

    store.logActivity({
      type: "monitor",
      label: `Ping ${monitor.name} — ${newStatus.toUpperCase()} (${responseTime}ms)`,
      targetId: req.params.id, targetType: "monitor",
      metadata: { url: monitor.url, responseTime, status: newStatus },
    }).catch(() => {});

    store.broadcast({ type: "monitor:ping", monitorId: req.params.id, status: newStatus, responseTime });
    res.json({ ok: true, status: newStatus, responseTime, statusCode, monitor: updated ? { ...updated, id: updated._id } : null });
  } catch (err) {
    logger.error({ err }, "[monitors] PING failed");
    res.status(500).json({ error: "Ping failed" });
  }
});

router.delete("/monitors/:id", async (req, res) => {
  try {
    await connectMongo();
    const existing = await MonitorModel.findByIdAndDelete(req.params.id).lean();
    if (existing) {
      store.logActivity({
        type: "monitor",
        label: `Monitor supprimé : ${existing.name} (${existing.url})`,
        targetId: req.params.id, targetType: "monitor",
        metadata: { url: existing.url, name: existing.name },
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[monitors] DELETE failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
