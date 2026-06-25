import { Router, Request, Response } from "express";
import { pool } from "@workspace/db";
import { validateMonitorUrl, isPrivateHost, checkDnsResolution } from "../lib/validateMonitorUrl.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

const router = Router();
const monitorCreateRateLimit = createRateLimit("reportsPerHour");
const E164_RE = /^\+[1-9]\d{7,14}$/;

const ALLOWED_ALERT_EMAIL = process.env["ALERT_EMAIL"] ?? "";
const ALLOWED_ALERT_PHONE = process.env["ALERT_PHONE"] ?? "";

// ── Validation helpers ─────────────────────────────────────────────────────────

function validateAlertEmail(email: string | undefined): string | null {
  if (!email) return null;
  if (!ALLOWED_ALERT_EMAIL)
    return "alertEmail cannot be set: no ALERT_EMAIL is configured on this server";
  if (email !== ALLOWED_ALERT_EMAIL)
    return "alertEmail must match the account-configured alert address";
  return null;
}

function validateAlertPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  if (!E164_RE.test(phone))
    return "alertPhone must be in E.164 format (e.g. +33612345678)";
  if (!ALLOWED_ALERT_PHONE)
    return "alertPhone cannot be set: no ALERT_PHONE is configured on this server";
  if (phone !== ALLOWED_ALERT_PHONE)
    return "alertPhone must match the account-configured alert phone number";
  return null;
}

// ── DB row → frontend shape ────────────────────────────────────────────────────
// Column names match the existing Supabase schema (uptime, latency, frequency).
// The JSON field names match what dashboard.js already expects.

function toPublic(row: Record<string, unknown>) {
  return {
    id:          row["id"],
    name:        row["name"],
    url:         row["url"],
    status:      row["status"],
    uptime:      row["uptime"],
    latency:     row["latency"],
    lastCheck:   row["last_check"],
    alertEmail:  row["alert_email"],
    alertPhone:  row["alert_phone"],
    isCritical:  row["is_critical"],
    frequency:   row["frequency"],
    orgId:       row["org_id"],
    createdAt:   row["created_at"],
    updatedAt:   row["updated_at"],
  };
}

// ── Real HTTP check ────────────────────────────────────────────────────────────

interface CheckResult {
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  error: string | null;
}

async function performCheck(url: string): Promise<CheckResult> {
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { /* ignore */ }

  if (
    !parsed ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    isPrivateHost(parsed.hostname) ||
    (await checkDnsResolution(parsed.hostname)) !== null
  ) {
    return { ok: false, statusCode: 0, latencyMs: 0, error: "URL blocked (private host or invalid protocol)" };
  }

  const start    = Date.now();
  const ctrl     = new AbortController();
  const timer    = setTimeout(() => ctrl.abort(), 8_000);
  const MAX_HOPS = 5;

  let currentUrl = url;
  let ok         = false;
  let statusCode = 0;
  let error: string | null = null;

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const resp = await fetch(currentUrl, {
        method: "HEAD",
        signal: ctrl.signal,
        redirect: "manual",
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (!location) break;
        let target: URL;
        try { target = new URL(location, currentUrl); } catch { break; }
        if (target.protocol !== "http:" && target.protocol !== "https:") break;
        if (isPrivateHost(target.hostname)) break;
        if ((await checkDnsResolution(target.hostname)) !== null) break;
        currentUrl = target.toString();
        continue;
      }

      statusCode = resp.status;
      ok = resp.ok || resp.status < 400;
      break;
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    error = msg.toLowerCase().includes("abort") ? "Timeout after 8s" : msg;
  } finally {
    clearTimeout(timer);
  }

  return { ok, statusCode, latencyMs: Date.now() - start, error };
}

// ── Save check + handle incident transitions ───────────────────────────────────

async function saveCheckResult(
  monitorId: string,
  orgId: string,
  previousStatus: string,
  result: CheckResult,
): Promise<string> {
  const checkId   = `chk${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const checkedAt = Date.now();
  const newStatus = result.ok ? "up" : "down";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Insert check record
    await client.query(
      `INSERT INTO monitor_checks (id, monitor_id, org_id, checked_at, ok, latency, status_code, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [checkId, monitorId, orgId, checkedAt, result.ok, result.latencyMs, result.statusCode || null, result.error],
    );

    // 2. Compute rolling uptime % (last 30 days)
    const uptimeRes = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE ok) AS ok_count,
         COUNT(*)                   AS total
       FROM monitor_checks
       WHERE monitor_id = $1 AND checked_at > $2`,
      [monitorId, checkedAt - 30 * 24 * 60 * 60 * 1000],
    );
    const okCount  = Number(uptimeRes.rows[0]?.ok_count ?? 0);
    const total    = Number(uptimeRes.rows[0]?.total    ?? 1);
    const uptimePct = total > 0 ? Math.round((okCount / total) * 1000) / 10 : 100;

    // 3. Update monitor row
    await client.query(
      `UPDATE monitors
       SET status = $1, latency = $2, uptime = $3, last_check = $4, updated_at = NOW()
       WHERE id = $5`,
      [newStatus, result.latencyMs, uptimePct, new Date().toISOString(), monitorId],
    );

    // 4. Incident transitions
    if (previousStatus === "up" && newStatus === "down") {
      // UP → DOWN : open a new incident
      const incId = `inc${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      await client.query(
        `INSERT INTO monitor_incidents (id, monitor_id, org_id, started_at, error)
         VALUES ($1, $2, $3, NOW(), $4)`,
        [incId, monitorId, orgId, result.error ?? "Service unreachable"],
      );
    } else if (previousStatus === "down" && newStatus === "up") {
      // DOWN → UP : resolve any open incident
      await client.query(
        `UPDATE monitor_incidents
         SET resolved_at = NOW(),
             duration_s  = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
         WHERE monitor_id = $1 AND resolved_at IS NULL`,
        [monitorId],
      );
    }

    await client.query("COMMIT");
    return newStatus;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── GET /monitors ─────────────────────────────────────────────────────────────

router.get("/monitors", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM monitors ORDER BY created_at DESC LIMIT 500`,
    );
    res.json(result.rows.map(toPublic));
  } catch (err) {
    logger.error({ err }, "[monitors] GET failed");
    res.status(503).json({ error: "Monitor database unavailable", monitors: [] });
  }
});

// ── GET /monitors/:id/checks-summary ─────────────────────────────────────────

router.get("/monitors/:id/checks-summary", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const now   = Date.now();
    const since = now - 30 * 24 * 60 * 60 * 1000;

    const result = await pool.query(
      `SELECT checked_at, ok FROM monitor_checks WHERE monitor_id = $1 AND checked_at >= $2`,
      [id, since],
    );

    const dayMap: Record<string, { ok: number; total: number }> = {};
    for (const row of result.rows) {
      const d   = new Date(Number(row.checked_at));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      if (!dayMap[key]) dayMap[key] = { ok: 0, total: 0 };
      dayMap[key].total++;
      if (row.ok) dayMap[key].ok++;
    }

    const days: { date: string; ok: number; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d   = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      days.push({ date: key, ok: dayMap[key]?.ok ?? 0, total: dayMap[key]?.total ?? 0 });
    }
    res.json(days);
  } catch {
    res.json([]);
  }
});

// ── GET /monitors/:id/checks ──────────────────────────────────────────────────

router.get("/monitors/:id/checks", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const days  = Math.min(Number(req.query["days"] ?? 30), 90);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const result = await pool.query(
      `SELECT * FROM monitor_checks
       WHERE monitor_id = $1 AND checked_at >= $2
       ORDER BY checked_at DESC LIMIT 10000`,
      [id, since],
    );
    res.json(result.rows.map(r => ({
      id:         r.id,
      monitorId:  r.monitor_id,
      ok:         r.ok,
      latency:    r.latency,
      statusCode: r.status_code,
      error:      r.error,
      checkedAt:  r.checked_at,
    })));
  } catch {
    res.json([]);
  }
});

// ── GET /monitors/:id/incidents ───────────────────────────────────────────────

router.get("/monitors/:id/incidents", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM monitor_incidents WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [id],
    );
    res.json(result.rows);
  } catch {
    res.json([]);
  }
});

// ── POST /monitors ────────────────────────────────────────────────────────────

router.post("/monitors", monitorCreateRateLimit, async (req: Request, res: Response) => {
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
    const id    = `m${Date.now()}`;
    const orgId = (req as Request & { orgId?: string }).orgId ?? "default";

    await pool.query(
      `INSERT INTO monitors
         (id, org_id, name, url, status, uptime, latency,
          frequency, alert_email, alert_phone, is_critical, last_check, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'up',100,0,$5,$6,$7,$8,$9,NOW(),NOW())`,
      [id, orgId, name, url, frequency ?? "5min", alertEmail ?? "", alertPhone ?? "", isCritical ?? false, new Date().toISOString()],
    );

    const row = await pool.query(`SELECT * FROM monitors WHERE id = $1`, [id]);
    store.logActivity({
      type: "monitor", label: `Monitor créé : ${name} (${url})`,
      targetId: id, targetType: "monitor", metadata: { url, name },
    }).catch(() => {});

    res.status(201).json(toPublic(row.rows[0]));
  } catch (err) {
    logger.error({ err }, "[monitors] POST failed");
    res.status(500).json({ error: "Failed to create monitor" });
  }
});

// ── PATCH /monitors/:id ───────────────────────────────────────────────────────

router.patch("/monitors/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as {
    name?: string; url?: string; alertEmail?: string;
    alertPhone?: string; isCritical?: boolean; frequency?: string;
  };

  if (body.url !== undefined) {
    const urlError = await validateMonitorUrl(body.url);
    if (urlError) { res.status(400).json({ error: urlError }); return; }
  }
  if (body.alertEmail) {
    const emailError = validateAlertEmail(body.alertEmail);
    if (emailError) { res.status(400).json({ error: emailError }); return; }
  }
  if (body.alertPhone) {
    const phoneError = validateAlertPhone(body.alertPhone);
    if (phoneError) { res.status(400).json({ error: phoneError }); return; }
  }

  // Build parameterised SET clause — $1 is reserved for the WHERE id
  const values: unknown[]    = [];
  const setClauses: string[] = [];

  function addField(col: string, val: unknown): void {
    values.push(val);
    setClauses.push(`${col} = $${values.length + 1}`); // +1 because $1 = id
  }

  if (body.name       !== undefined) addField("name",        body.name);
  if (body.url        !== undefined) addField("url",         body.url);
  if (body.alertEmail !== undefined) addField("alert_email", body.alertEmail);
  if (body.alertPhone !== undefined) addField("alert_phone", body.alertPhone);
  if (body.isCritical !== undefined) addField("is_critical", body.isCritical);
  if (body.frequency  !== undefined) addField("frequency",   body.frequency);

  if (setClauses.length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }
  setClauses.push("updated_at = NOW()");

  try {
    const result = await pool.query(
      `UPDATE monitors SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (result.rowCount === 0) { res.status(404).json({ error: "not found" }); return; }
    res.json(toPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[monitors] PATCH failed");
    res.status(500).json({ error: "Update failed" });
  }
});

// ── POST /monitors/:id/check  (alias: /ping) ──────────────────────────────────

async function handleCheck(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  try {
    const monRow = await pool.query(`SELECT * FROM monitors WHERE id = $1`, [id]);
    if (monRow.rowCount === 0) { res.status(404).json({ error: "Monitor not found" }); return; }

    const monitor        = monRow.rows[0] as Record<string, unknown>;
    const previousStatus = monitor["status"] as string;
    const orgId          = (monitor["org_id"] as string) ?? "default";

    const result    = await performCheck(monitor["url"] as string);
    const newStatus = await saveCheckResult(id, orgId, previousStatus, result);

    const updated = await pool.query(`SELECT * FROM monitors WHERE id = $1`, [id]);

    store.logActivity({
      type: "monitor",
      label: `Ping ${String(monitor["name"])} — ${newStatus.toUpperCase()} (${result.latencyMs}ms)`,
      targetId: id, targetType: "monitor",
      metadata: { url: monitor["url"], responseTime: result.latencyMs, status: newStatus },
    }).catch(() => {});

    store.broadcast({ type: "monitor:ping", monitorId: id, status: newStatus, responseTime: result.latencyMs });

    res.json({
      ok:           true,
      status:       newStatus,
      responseTime: result.latencyMs,
      statusCode:   result.statusCode,
      monitor:      updated.rowCount ? toPublic(updated.rows[0]) : null,
    });
  } catch (err) {
    logger.error({ err }, "[monitors] CHECK failed");
    res.status(500).json({ error: "Check failed" });
  }
}

router.post("/monitors/:id/check", handleCheck);
router.post("/monitors/:id/ping",  handleCheck);

// ── POST /monitors/:id/test-sms ───────────────────────────────────────────────
// Sends a test SMS alert for a monitor (requires TWILIO or similar — stub OK)
router.post("/monitors/:id/test-sms", async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  res.json({ ok: true, message: `Test SMS would be sent to ${phone}` });
});

// ── DELETE /monitors/:id ──────────────────────────────────────────────────────

router.delete("/monitors/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const existing = await pool.query(`SELECT * FROM monitors WHERE id = $1`, [id]);
    if (existing.rowCount === 0) { res.json({ ok: true }); return; }
    const m = existing.rows[0] as Record<string, unknown>;

    await pool.query(`DELETE FROM monitor_checks    WHERE monitor_id = $1`, [id]);
    await pool.query(`DELETE FROM monitor_incidents WHERE monitor_id = $1`, [id]);
    await pool.query(`DELETE FROM monitors          WHERE id = $1`,         [id]);

    store.logActivity({
      type: "monitor",
      label: `Monitor supprimé : ${String(m["name"])} (${String(m["url"])})`,
      targetId: id, targetType: "monitor",
      metadata: { url: m["url"], name: m["name"] },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[monitors] DELETE failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
