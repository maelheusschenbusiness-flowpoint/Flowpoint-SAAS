import crypto from "node:crypto";
import { requireOrgId } from "../lib/require-org-id.js";
import { Router, Request, Response } from "express";
import { pool, withOrgDb } from "@workspace/db";
import { validateMonitorUrl, isPrivateHost, checkDnsResolution } from "../middlewares/validateMonitorUrl.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

const router = Router();
const monitorCreateRateLimit = createRateLimit("reportsPerHour");
const E164_RE = /^\+[1-9]\d{7,14}$/;

const ALLOWED_ALERT_EMAIL = process.env["ALERT_EMAIL"] ?? "";
const ALLOWED_ALERT_PHONE = process.env["ALERT_PHONE"] ?? "";

// ── Validation helpers ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateAlertEmail(email: string | undefined): string | null {
  if (!email) return null;
  if (!EMAIL_RE.test(email)) return "alertEmail must be a valid email address";
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
    // BUG-W2-MON-001: expose enabled; explicitly preserve false
    enabled:     row["enabled"] !== false,
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
// Uses withOrgDb so RLS is enforced: INSERT/UPDATE only affect this org's rows.

async function saveCheckResult(
  monitorId: string,
  orgId: string,
  previousStatus: string,
  result: CheckResult,
): Promise<{ newStatus: string }> {
  const checkId   = `chk${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const checkedAt = Date.now();
  const newStatus = result.ok ? "up" : "down";

  let notifyAfterCommit:
    | { kind: "down"; mon: Record<string, unknown> | undefined }
    | { kind: "up"; mon: Record<string, unknown> | undefined; downDurationMin: number }
    | null = null;

  await withOrgDb(orgId, async (client) => {
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
    const okCount   = Number(uptimeRes.rows[0]?.ok_count ?? 0);
    const total     = Number(uptimeRes.rows[0]?.total    ?? 1);
    const uptimePct = total > 0 ? Math.round((okCount / total) * 1000) / 10 : 100;

    // 3. Update monitor row
    await client.query(
      `UPDATE monitors
       SET status = $1, latency = $2, uptime = $3, last_check = $4, updated_at = NOW()
       WHERE id = $5`,
      [newStatus, result.latencyMs, uptimePct, new Date().toISOString(), monitorId],
    );

    // 4. Incident transitions
    // Wrapped in try/catch: an incident insert/update failure (e.g. schema
    // drift) must never abort the check-result write or crash the cron loop.
    // IMPORTANT: do NOT fire-and-forget any client.query() calls here — this
    // `client` belongs to the withOrgDb transaction and gets COMMIT'd and
    // released back to the pool the moment this callback returns. An
    // un-awaited query on it can execute after release, against a connection
    // that's since been handed to a completely different request's
    // transaction (wrong org context) or silently dropped — and previously
    // caused the entire check-result write to appear to succeed while
    // nothing was actually persisted. All notification data must be
    // gathered here (still inside the transaction, awaited), and any actual
    // email/SMS send must happen AFTER withOrgDb resolves, using data only —
    // never the transaction's client.
    // SAVEPOINT guard: any SQL error inside this block (e.g. a schema
    // mismatch on monitor_incidents) would otherwise abort the ENTIRE
    // enclosing transaction. Postgres silently converts a COMMIT on an
    // aborted transaction into a ROLLBACK (no JS exception thrown), which
    // previously discarded the already-succeeded monitor_checks insert and
    // monitors update from sections 1-3 above without any visible error.
    // Wrapping this block in its own SAVEPOINT means a failure here can be
    // rolled back in isolation, leaving the rest of the transaction intact.
    await client.query("SAVEPOINT incident_txn");
    try {
      if (previousStatus === "up" && newStatus === "down") {
        // monitor_incidents.id is a UUID column — must use crypto.randomUUID(),
        // never a custom "inc"+timestamp string (causes 22P02 invalid input
        // syntax for type uuid).
        const incId = crypto.randomUUID();
        await client.query(
          `INSERT INTO monitor_incidents (id, monitor_id, org_id, started_at, error)
           VALUES ($1, $2, $3, NOW(), $4)`,
          [incId, monitorId, orgId, result.error ?? "Service unreachable"],
        );
        const monRow = await client.query(
          `SELECT name, url, alert_email, alert_phone FROM monitors WHERE id = $1 LIMIT 1`, [monitorId]
        );
        notifyAfterCommit = { kind: "down", mon: monRow.rows[0] };
      } else if (previousStatus === "down" && newStatus === "up") {
        const incRes = await client.query(
          `UPDATE monitor_incidents
           SET resolved_at = NOW(),
               duration_s  = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
           WHERE monitor_id = $1 AND resolved_at IS NULL
           RETURNING EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER AS duration_s`,
          [monitorId],
        );
        const downDurationMin = incRes.rows[0]?.duration_s ? Math.round(Number(incRes.rows[0].duration_s) / 60) : 0;
        const monRow = await client.query(
          `SELECT name, url, alert_email, alert_phone FROM monitors WHERE id = $1 LIMIT 1`, [monitorId]
        );
        notifyAfterCommit = { kind: "up", mon: monRow.rows[0], downDurationMin };
      }
      await client.query("RELEASE SAVEPOINT incident_txn");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT incident_txn").catch(() => {});
      logger.error({ err, monitorId, previousStatus, newStatus }, "[monitors] incident transition failed — check result was still saved");
    }
  });

  // Fire-and-forget notifications AFTER the transaction has committed and
  // its client has been released — never touch the transaction's client here.
  if (notifyAfterCommit) {
    (async () => {
      try {
        const { mailer } = await import("../services/mailer.js");
        const { store } = await import("../services/store.js");
        const mon = notifyAfterCommit!.mon;
        if (!mon) return;

        const isDown = notifyAfterCommit!.kind === "down";
        const notifTitle = isDown
          ? `Monitor DOWN : ${String(mon.name)}`
          : `Monitor rétabli : ${String(mon.name)}`;
        const notifMessage = isDown
          ? `${String(mon.url)} est inaccessible.`
          : `${String(mon.url)} est de nouveau opérationnel (indisponible ${notifyAfterCommit!.downDurationMin ?? 0} min).`;

        // Write to notifications table so the dashboard bell shows it
        pool.connect().then(client =>
          client.query(
            `INSERT INTO notifications (id, org_id, type, title, message, link, read, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
            [
              `notif_mon_${Date.now()}`,
              orgId,
              isDown ? "danger" : "success",
              notifTitle,
              notifMessage,
              "/monitors",
            ]
          )
            .catch(err => logger.error({ err, monitorId }, "[monitors] Failed to write notification to DB"))
            .finally(() => client.release())
        ).catch(err => logger.error({ err }, "[monitors] Pool connect failed for notification write"));

        // Log activity so the activity feed reflects the state change
        store.logActivity({
          type: "monitor",
          label: notifTitle,
          targetId: monitorId,
          targetType: "monitor",
          metadata: { url: String(mon.url), kind: notifyAfterCommit!.kind },
        }).catch(err => logger.error({ err }, "[monitors] logActivity failed"));

        const recipient = (mon.alert_email as string | undefined)?.trim() || store.me.email;
        if (recipient) {
          if (isDown) {
            await mailer.sendMonitorDown({
              to: recipient,
              monitorName: String(mon.name),
              url: String(mon.url),
              statusCode: result.statusCode ?? undefined,
            });
          } else {
            await mailer.sendMonitorUp({
              to: recipient,
              monitorName: String(mon.name),
              url: String(mon.url),
              downDurationMin: notifyAfterCommit!.downDurationMin ?? 0,
            });
          }
        }
        const phone = (mon.alert_phone as string | undefined)?.trim();
        if (phone) {
          const { sendSms, twilioConfigured } = await import("../services/sms-service.js");
          if (twilioConfigured()) {
            const msg = isDown
              ? `Flowpoint ALERTE : ${String(mon.name)} (${String(mon.url)}) est DOWN.`
              : `Flowpoint : ${String(mon.name)} (${String(mon.url)}) est de nouveau UP.`;
            await sendSms(phone, msg);
          }
        }

        // BUG-W2-ALT-003: fire/resolve alert_events for monitor transitions
        const { fireAlertEvent, resolveAlertEvents } = await import("../services/alert-events-service.js");
        const monUrl = (mon.url as string | undefined) ?? "";
        if (isDown) {
          // Fire alert_events for all matching monitor_down rules
          const rClient = await pool.connect();
          try {
            const { rows: rules } = await rClient.query(
              `SELECT id, name, site_urls FROM alert_rules WHERE org_id=$1 AND type='monitor_down' AND enabled=true`,
              [orgId],
            );
            for (const rule of rules) {
              const siteUrls: string[] = (() => { try { return JSON.parse(rule["site_urls"] as string) as string[]; } catch { return []; } })();
              if (siteUrls.length > 0 && !siteUrls.some((u: string) => monUrl.startsWith(u) || u === monUrl)) continue;
              await fireAlertEvent({
                orgId,
                ruleId:     String(rule["id"]),
                ruleName:   String(rule["name"]),
                type:       "monitor_down",
                severity:   "critical",
                message:    `${monUrl} est inaccessible`,
                siteUrl:    monUrl,
                monitorId,
                // Unique per org+monitor+rule — ON CONFLICT DO NOTHING deduplicates
                dedupeKey:  `mon_down_${orgId}_${monitorId}_${String(rule["id"])}`,
              });
            }
          } finally { rClient.release(); }
        } else {
          // Resolve open monitor_down events for this monitor
          await resolveAlertEvents({ orgId, monitorId, type: "monitor_down" });
          // Fire alert_events for all matching monitor_up rules (no dedup — each recovery is unique)
          const rClient = await pool.connect();
          try {
            const { rows: rules } = await rClient.query(
              `SELECT id, name, site_urls FROM alert_rules WHERE org_id=$1 AND type='monitor_up' AND enabled=true`,
              [orgId],
            );
            for (const rule of rules) {
              const siteUrls: string[] = (() => { try { return JSON.parse(rule["site_urls"] as string) as string[]; } catch { return []; } })();
              if (siteUrls.length > 0 && !siteUrls.some((u: string) => monUrl.startsWith(u) || u === monUrl)) continue;
              await fireAlertEvent({
                orgId,
                ruleId:   String(rule["id"]),
                ruleName: String(rule["name"]),
                type:     "monitor_up",
                severity: "info",
                message:  `${monUrl} est de nouveau opérationnel`,
                siteUrl:  monUrl,
                monitorId,
              });
            }
          } finally { rClient.release(); }
        }
      } catch { /* non-fatal */ }
    })();
  }

  return { newStatus };
}

// ── GET /monitors ─────────────────────────────────────────────────────────────
// req.orgDb scopes via RLS → only this org's monitors are returned.

router.get("/monitors", async (req: Request, res: Response) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const result = await req.orgDb(
      `SELECT * FROM monitors WHERE org_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [orgId],
    );
    res.json(result.rows.map(toPublic));
  } catch (err) {
    logger.error({ err }, "[monitors] GET failed");
    res.status(503).json({ error: "Monitor database unavailable", monitors: [] });
  }
});

// ── GET /monitors/:id ────────────────────────────────────────────────────────

router.get("/monitors/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await req.orgDb(
      `SELECT * FROM monitors WHERE id = $1 LIMIT 1`, [id],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Monitor not found" }); return; }
    res.json(toPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[monitors] GET :id failed");
    res.status(503).json({ error: "Monitor database unavailable" });
  }
});

// ── GET /monitors/:id/checks-summary ─────────────────────────────────────────

router.get("/monitors/:id/checks-summary", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const now   = Date.now();
    const since = now - 30 * 24 * 60 * 60 * 1000;

    const result = await req.orgDb(
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

    const result = await req.orgDb(
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
    const result = await req.orgDb(
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
    const orgId = requireOrgId(req, res);
    if (!orgId) return;

    // Guard: same URL already monitored for this org
    const dup = await req.orgDb(
      `SELECT id FROM monitors WHERE org_id = $1 AND url = $2 LIMIT 1`,
      [orgId, url]
    );
    if (dup.rows.length) {
      res.status(409).json({ error: "Cette URL est déjà surveillée", duplicateId: dup.rows[0].id });
      return;
    }

    await req.orgDb(
      `INSERT INTO monitors
         (id, org_id, name, url, status, uptime, latency,
          frequency, alert_email, alert_phone, is_critical, last_check, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'up',100,NULL,$5,$6,$7,$8,NULL,NOW(),NOW())`,
      [id, orgId, name, url, frequency ?? "5min", alertEmail ?? "", alertPhone ?? "", isCritical ?? false],
    );

    const row = await req.orgDb(`SELECT * FROM monitors WHERE id = $1`, [id]);
    store.logActivity({
      type: "monitor", label: `Monitor créé : ${name} (${url})`,
      targetId: id, targetType: "monitor", metadata: { url, name },
    }).catch(err => logger.error({ err }, "[monitors] logActivity failed"));

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
    enabled?: boolean;
  };

  // BUG-W2-MON-001: enabled must be a strict boolean (never a string or number)
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean (true or false)" }); return;
  }

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

  const values: unknown[]    = [];
  const setClauses: string[] = [];

  function addField(col: string, val: unknown): void {
    values.push(val);
    setClauses.push(`${col} = $${values.length + 1}`);
  }

  if (body.name       !== undefined) addField("name",        body.name);
  if (body.url        !== undefined) addField("url",         body.url);
  if (body.alertEmail !== undefined) addField("alert_email", body.alertEmail);
  if (body.alertPhone !== undefined) addField("alert_phone", body.alertPhone);
  if (body.isCritical !== undefined) addField("is_critical", body.isCritical);
  if (body.frequency  !== undefined) addField("frequency",   body.frequency);
  // BUG-W2-MON-001: pause/resume
  if (body.enabled    !== undefined) addField("enabled",     body.enabled);

  if (setClauses.length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }
  setClauses.push("updated_at = NOW()");

  try {
    const result = await req.orgDb(
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
    const monRow = await req.orgDb(`SELECT * FROM monitors WHERE id = $1`, [id]);
    if (monRow.rowCount === 0) { res.status(404).json({ error: "Monitor not found" }); return; }

    const monitor        = monRow.rows[0] as Record<string, unknown>;
    const previousStatus = monitor["status"] as string;
    const orgId          = monitor["org_id"] as string | undefined;
    if (!orgId) { res.status(500).json({ error: "Monitor data integrity error: missing org_id" }); return; }

    const result    = await performCheck(monitor["url"] as string);
    const { newStatus } = await saveCheckResult(id, orgId, previousStatus, result);

    const updated = await req.orgDb(`SELECT * FROM monitors WHERE id = $1`, [id]);

    store.logActivity({
      type: "monitor",
      label: `Ping ${String(monitor["name"])} — ${newStatus.toUpperCase()} (${result.latencyMs}ms)`,
      targetId: id, targetType: "monitor",
      metadata: { url: monitor["url"], responseTime: result.latencyMs, status: newStatus },
    }).catch(err => logger.error({ err }, "[monitors] logActivity failed"));

    store.broadcast({ type: "monitor:ping", monitorId: id, status: newStatus, responseTime: result.latencyMs }, orgId);

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

// ── Periodic background checks (called by monitor-cron every few minutes) ────
// Runs a real HTTP check for every monitor across all orgs, respecting each
// monitor's own `frequency` (in minutes) so we don't over-check.

export async function checkAllMonitorsDue(): Promise<{ checked: number; errors: number }> {
  let checked = 0;
  let errors = 0;
  const client = await pool.connect();
  try {
    // Legacy/demo rows sometimes have a non-timestamp string in last_check
    // (e.g. a display placeholder like "2 min") — normalize those first so
    // the due-check query below never crashes on a bad cast.
    await client.query(
      `UPDATE monitors
       SET last_check = (NOW() - INTERVAL '1 hour')::text
       WHERE last_check IS NULL
          OR last_check = ''
          OR last_check !~ '^\\d{4}-\\d{2}-\\d{2}'`
    );
    // BUG-W2-MON-001: only check monitors that are not paused
    const { rows } = await client.query(
      `SELECT id, org_id, url, status, frequency, last_check
       FROM monitors
       WHERE enabled = TRUE
         AND last_check::timestamptz < NOW() - (GREATEST(COALESCE(NULLIF(regexp_replace(frequency, '[^0-9]', '', 'g'), '')::int, 5), 1) || ' minutes')::interval`
    );
    for (const monitor of rows) {
      const _cronOrgId = monitor["org_id"] as string | undefined;
      if (!_cronOrgId) { errors++; continue; }
      try {
        const result = await performCheck(monitor["url"] as string);
        await saveCheckResult(
          monitor["id"] as string,
          _cronOrgId,
          monitor["status"] as string,
          result,
        );
        checked++;
      } catch (err) {
        errors++;
        logger.warn({ err, monitorId: monitor["id"] }, "[monitor-cron] background check failed");
      }
    }
  } finally {
    client.release();
  }
  return { checked, errors };
}

// ── POST /monitors/:id/test-sms ───────────────────────────────────────────────

router.post("/monitors/:id/test-sms", async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const { sendSms, twilioConfigured } = await import("../services/sms-service.js");
  if (!twilioConfigured()) {
    res.status(503).json({ ok: false, error: "SMS non configuré : ajoutez TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM_NUMBER." });
    return;
  }
  const result = await sendSms(phone, "Flowpoint : ceci est un SMS de test pour vos alertes de monitoring.");
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.error ?? "Envoi SMS échoué" });
    return;
  }
  res.json({ ok: true, message: `SMS de test envoyé à ${phone}`, sid: result.sid });
});

// ── DELETE /monitors/:id ──────────────────────────────────────────────────────
// RLS ensures cross-org deletes are silently blocked.

router.delete("/monitors/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const existing = await req.orgDb(`SELECT * FROM monitors WHERE id = $1`, [id]);
    if (existing.rowCount === 0) { res.json({ ok: true }); return; }
    const m = existing.rows[0] as Record<string, unknown>;

    await req.orgDb(`DELETE FROM monitor_checks    WHERE monitor_id = $1`, [id]);
    await req.orgDb(`DELETE FROM monitor_incidents WHERE monitor_id = $1`, [id]);
    await req.orgDb(`DELETE FROM monitors          WHERE id = $1`,         [id]);

    store.logActivity({
      type: "monitor",
      label: `Monitor supprimé : ${String(m["name"])} (${String(m["url"])})`,
      targetId: id, targetType: "monitor",
      metadata: { url: m["url"], name: m["name"] },
    }).catch(err => logger.error({ err }, "[monitors] logActivity failed"));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[monitors] DELETE failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
