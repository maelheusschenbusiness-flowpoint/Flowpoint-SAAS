import { Router, Request, Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { canWrite, canAdmin } from "../middlewares/requireRole.js";
import { pool } from "@workspace/db";
import { computeNextRun, isValidFrequency } from "../services/schedule-utils.js";
import { launchAudit, normalizeAuditUrl } from "../services/audit-runner.js";
import { toScheduleRunValue, scheduleCreatedAtNowSql } from "../services/audit-schedule-cron.js";
import { reportRateLimit as auditRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── DB row → public shape ──────────────────────────────────────────────────────
function auditToPublic(row: Record<string, unknown>) {
  return {
    id:        row["id"],
    name:      row["name"] ?? "",
    notes:     row["notes"] ?? "",
    url:       row["url"],
    score:     row["score"],
    status:    row["status"],
    speed:     row["speed"],
    date:      row["date"],
    issues:    row["issues"],
    origin:    row["origin"],
    createdAt: row["created_at"],
  };
}

function scheduleToPublic(row: Record<string, unknown>) {
  return {
    id:        row["id"],
    url:       row["url"],
    frequency: row["frequency"],
    nextRun:   row["next_run"],
    lastRun:   row["last_run"],
    enabled:   row["enabled"],
    orgId:     row["org_id"],
  };
}

// ── GET /audits ───────────────────────────────────────────────────────────────
// req.orgDb scopes the query to the authenticated org via RLS.

router.get("/audits", async (req: Request, res: Response) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const result = await req.orgDb(
      `SELECT * FROM audits WHERE org_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [orgId],
    );
    res.json(result.rows.map(auditToPublic));
  } catch (err) {
    logger.error({ err }, "[audits] GET failed");
    res.json([]);
  }
});

// ── POST /audits ──────────────────────────────────────────────────────────────

router.post("/audits", auditRateLimit, canWrite, async (req: Request, res: Response) => {
  const { url, origin = "manual", type, force } = req.body as { url?: string; origin?: string; type?: string; force?: boolean };
  const normalizedUrl = normalizeAuditUrl(url);
  if (!normalizedUrl) {
    res.status(400).json({
      error: "L’URL doit être une adresse HTTP ou HTTPS valide.",
      code: "INVALID_AUDIT_URL",
    });
    return;
  }
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  try {
    // Guard: audit running on same URL for this org today
    // Skipped when force=true (user explicitly retrying an existing audit).
    // BUG-005 fix: audits.date is TEXT — compare via created_at (TIMESTAMP) to avoid
    // "operator does not exist: text >= timestamp with time zone" PostgreSQL error.
    if (!force) {
      const dup = await req.orgDb(
        `SELECT id FROM audits WHERE org_id = $1 AND url = $2 AND created_at >= date_trunc('day', now()) LIMIT 1`,
        [orgId, normalizedUrl]
      );
      if (dup.rows.length) {
        res.status(409).json({ error: "Audit déjà lancé aujourd'hui", code: "DUPLICATE_AUDIT", duplicateId: dup.rows[0].id });
        return;
      }
    }

    // ── Atomic quota enforcement + INSERT under pg_advisory_xact_lock ───────
    // pg_advisory_xact_lock (transaction-level) works correctly with Supabase
    // PgBouncer — the lock is held for the duration of the transaction and
    // automatically released on COMMIT/ROLLBACK. Session-level advisory locks
    // do NOT work with PgBouncer transaction pooling because consecutive queries
    // on the same client can be routed to different backend sessions.
    //
    // Pattern: BEGIN → xact_lock → COUNT → (ok) INSERT → COMMIT
    //          Lock is released at COMMIT; INSERT is already visible to others.
    //          Then call launchAudit(preInsertedId=…) to do PSI/notifications.
    let _auLockClient: import("pg").PoolClient | null = null;
    const _auLockKey = `${orgId}:audits`;
    try {
      const { pool: _auPool } = await import("@workspace/db");
      const { checkQuota } = await import("../services/billing-service.js");

      _auLockClient = await _auPool.connect();
      await _auLockClient.query("BEGIN");
      await _auLockClient.query(
        `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [_auLockKey]
      );

      // Re-count within the lock (xact_lock ensures serialization)
      const quota = await checkQuota("audits", orgId);
      if (!quota.allowed) {
        await _auLockClient.query("ROLLBACK");
        _auLockClient.release(); _auLockClient = null;
        res.status(402).json({
          error: `Limite mensuelle d'audits atteinte (${quota.used}/${quota.limit}). Upgradez votre plan ou achetez un pack d'audits supplémentaires.`,
          code: "QUOTA_EXCEEDED", resource: "audits", used: quota.used, limit: quota.limit,
        });
        return;
      }

      // INSERT the audit row inside the transaction (claims the slot atomically)
      const _aCtx   = (req as any).orgContext || {};
      const _auId   = `a${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
      const _auDate = new Date().toISOString();
      const _auName = ((req.body as Record<string,unknown>)["name"] as string) || "";
      const _auBy   = _aCtx.userId || _aCtx.email || null;
      await _auLockClient.query(
        `INSERT INTO audits (id, url, name, score, status, speed, date, issues, origin, org_id, created_by, created_at)
         VALUES ($1,$2,$3,0,'processing',0,$4,0,$5,$6,$7,NOW())`,
        [_auId, normalizedUrl, _auName, _auDate, origin, orgId, _auBy]
      );
      await _auLockClient.query("COMMIT");
      // Lock released at COMMIT; slot is now committed and visible to other requests.
      _auLockClient.release(); _auLockClient = null;

      // Now trigger PSI analysis + notifications outside the transaction.
      // preInsertedId tells launchAudit to skip the INSERT (already done above).
      const launched = await launchAudit({
        orgId, url: normalizedUrl, origin, name: _auName,
        userId: _aCtx.userId || _aCtx.email || "system",
        userName: _aCtx.name || _aCtx.email || "Système",
        preInsertedId: _auId,
      });
      res.status(201).json({ ...launched, type: type ?? "SEO complet" });
    } catch (err) {
      logger.error({ err }, "[audits] POST failed");
      if (!res.headersSent) {
        res.status(500).json({ error: "La création de l'audit a échoué. Réessayez dans un instant.", code: "AUDIT_CREATE_FAILED" });
      }
    } finally {
      if (_auLockClient) {
        await _auLockClient.query("ROLLBACK").catch(() => {});
        _auLockClient.release();
      }
    }
  } catch (outerErr) {
    // Outer try covers the duplicate guard (lines above the advisory lock block).
    logger.error({ err: outerErr }, "[audits] POST outer error");
    if (!res.headersSent) {
      res.status(500).json({ error: "La création de l'audit a échoué. Réessayez dans un instant.", code: "AUDIT_CREATE_FAILED" });
    }
  }
});

// ── GET /audits/history ───────────────────────────────────────────────────────
// Must be registered BEFORE /:id so Express doesn't match "history" as an id.

router.get("/audits/history", async (req: Request, res: Response) => {
  const url     = req.query.url as string | undefined;
  const daysRaw = parseInt((req.query.days as string) || "90", 10);
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  // retention365d add-on: extend historical lookback beyond 90 days (up to 365)
  let maxDays = 90; // default: 90 days
  try {
    const { loadBillingContext } = await import("../services/billing-context.js");
    const bCtx = await loadBillingContext(orgId).catch(() => null);
    if (bCtx?.addons?.["retention365d"]) maxDays = 365;
    else if (bCtx?.addons?.["retention90d"]) maxDays = 90;
  } catch { /* non-blocking */ }

  // Cap requested days to what the org is entitled to
  const requestedDays = Number.isFinite(daysRaw) ? Math.max(1, daysRaw) : 90;
  const days = Math.min(requestedDays, maxDays);

  if (!url) { res.status(400).json({ error: "url required", maxDays }); return; }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = await req.orgDb(
      `SELECT * FROM audits WHERE url = $1 AND date >= $2 AND org_id = $3 ORDER BY date ASC LIMIT 365`,
      [url, cutoff, orgId],
    );
    res.json(result.rows.map(auditToPublic));
  } catch { res.json([]); }
});

// ── GET /audits/quick-scan ────────────────────────────────────────────────────
// Must be registered BEFORE /:id.

router.get("/audits/quick-scan", async (req: Request, res: Response) => {
  const url   = req.query.url as string | undefined;
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const result = url
      ? await req.orgDb(
          `SELECT * FROM audits WHERE url = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [url, orgId],
        )
      : await req.orgDb(
          `SELECT * FROM audits WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [orgId],
        );
    if (result.rowCount && result.rowCount > 0) {
      res.json(auditToPublic(result.rows[0]));
    } else {
      res.json({ score: 0, status: "no-data", url: url ?? "" });
    }
  } catch { res.json({ score: 0, status: "no-data", url: url ?? "" }); }
});

// ── GET /audits/schedule + /audits/upcoming ───────────────────────────────────
// Must be registered BEFORE /:id.

router.get("/audits/schedule",  listSchedules);
router.get("/audits/upcoming",  upcomingSchedules);

// ── GET /audits/:id ───────────────────────────────────────────────────────────

router.get("/audits/:id", async (req: Request, res: Response) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const result = await req.orgDb(
      // Defense-in-depth: explicit org_id even though orgDb enforces RLS.
      `SELECT * FROM audits WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [req.params.id, orgId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Audit not found" }); return; }
    res.json(auditToPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[audits] GET by id failed");
    res.status(500).json({ error: "Failed to fetch audit" });
  }
});

// ── PATCH /audits/:id ─────────────────────────────────────────────────────────
router.patch("/audits/:id", canWrite, async (req: Request, res: Response) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const { name, notes } = req.body as { name?: string; notes?: string };
  try {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (name !== undefined)  { params.push(name);  updates.push(`name=$${params.length}`); }
    if (notes !== undefined) { params.push(notes); updates.push(`notes=$${params.length}`); }
    if (updates.length === 0) { res.json({ ok: true }); return; }
    params.push(req.params.id);
    params.push(orgId);
    const r = await req.orgDb(
      `UPDATE audits SET ${updates.join(", ")} WHERE id=$${params.length - 1} AND org_id=$${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Audit not found" }); return; }
    res.json(auditToPublic(r.rows[0]));
  } catch (err) {
    logger.error({ err }, "[audits] PATCH failed");
    res.status(500).json({ error: "Failed to update audit" });
  }
});

// ── DELETE /audits/:id ────────────────────────────────────────────────────────
// RLS ensures only the org's own audits can be deleted.

router.delete("/audits/:id", canAdmin, async (req: Request, res: Response) => {
  // Defense in depth: explicit org_id guard in addition to RLS (BUG-F)
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await req.orgDb(
      `DELETE FROM audits WHERE id = $1 AND org_id = $2 RETURNING id`,
      [req.params.id, orgId]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Audit not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete audit" });
  }
});

// ── Schedules ─────────────────────────────────────────────────────────────────

async function listSchedules(req: Request, res: Response) {
  try {
    const result = await req.orgDb(
      `SELECT * FROM audit_schedules ORDER BY created_at DESC LIMIT 200`,
    );
    res.json(result.rows.map(scheduleToPublic));
  } catch { res.json([]); }
}

async function upcomingSchedules(req: Request, res: Response) {
  try {
    // Self-heal stale schedules FIRST (across ALL enabled rows, not just the top 3):
    // a next_run in the past must be rolled forward to the next FUTURE occurrence
    // (never display "upcoming" audits dated yesterday). Healing before the final
    // ORDER BY/LIMIT guarantees the response is the globally earliest 3 schedules.
    const now = Date.now();
    const staleResult = await req.orgDb(
      `SELECT * FROM audit_schedules WHERE enabled = true`,
    );
    const parseNextRun = (v: unknown): { date: Date | null; numeric: boolean } => {
      if (v == null) return { date: null, numeric: false };
      // bigint epoch-ms comes back from pg as a digit string; timestamps as Date/ISO
      if (typeof v === "number") return { date: new Date(v), numeric: true };
      if (typeof v === "string" && /^\d+$/.test(v)) return { date: new Date(Number(v)), numeric: true };
      const d = new Date(v as string);
      return { date: isNaN(d.getTime()) ? null : d, numeric: false };
    };
    // #437 — the scheduled-audit cron (audit-schedule-cron.ts) now OWNS advancing
    // next_run: an overdue schedule means "fires within the next minute", so the
    // old display-time roll-forward (which silently skipped the run) is removed.
    // Display-only normalization: overdue rows show "imminent" via now + 1 min.
    const healed = staleResult.rows.map((row: Record<string, unknown>) => {
      const { date: nextRun } = parseNextRun(row["next_run"]);
      if (nextRun && !isNaN(nextRun.getTime()) && nextRun.getTime() < now) {
        return { ...row, next_run: new Date(now + 60_000).toISOString() };
      }
      return row;
    });
    const _t = (v: unknown) => { const p = parseNextRun(v); return p.date ? p.date.getTime() : Number.MAX_SAFE_INTEGER; };
    healed.sort((a: Record<string, unknown>, b: Record<string, unknown>) => _t(a["next_run"]) - _t(b["next_run"]));
    res.json(healed.slice(0, 3).map(scheduleToPublic));
  } catch { res.json([]); }
}

async function createSchedule(req: Request, res: Response) {
  const { url, frequency = "weekly" } = req.body as { url?: string; frequency?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  if (!isValidFrequency(frequency)) {
    res.status(400).json({ error: "frequency must be daily, weekly or monthly" }); return;
  }
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  // Schema-aware: next_run is BIGINT epoch-ms on live DBs, TIMESTAMP on fresh
  // installs — binding a raw Date to a BIGINT column is rejected by Postgres.
  const nextRun = await toScheduleRunValue(computeNextRun(frequency));
  try {
    const existing = await req.orgDb(
      `SELECT id FROM audit_schedules WHERE url = $1 AND org_id = $2`,
      [url, orgId],
    );
    let result;
    if (existing.rowCount && existing.rowCount > 0) {
      result = await req.orgDb(
        `UPDATE audit_schedules SET frequency=$1, next_run=$2 WHERE url=$3 AND org_id=$4 RETURNING *`,
        [frequency, nextRun, url, orgId],
      );
    } else {
      const id = `sched${Date.now()}`;
      // created_at is also BIGINT epoch-ms on live DBs — NOW() would be rejected.
      const createdAtSql = await scheduleCreatedAtNowSql();
      result = await req.orgDb(
        `INSERT INTO audit_schedules (id, url, frequency, next_run, enabled, org_id, created_at)
         VALUES ($1,$2,$3,$4,true,$5,${createdAtSql}) RETURNING *`,
        [id, url, frequency, nextRun, orgId],
      );
    }
    res.json(scheduleToPublic(result.rows[0]));
  } catch (err) {
    logger.error({ err }, "[audits] schedule POST failed");
    res.status(500).json({ error: "Failed to create schedule" });
  }
}

async function patchSchedule(req: Request, res: Response) {
  const { frequency } = req.body as { frequency?: string };
  if (!frequency || !isValidFrequency(frequency)) {
    res.status(400).json({ error: "frequency must be daily, weekly or monthly" }); return;
  }
  try {
    const result = await req.orgDb(
      `UPDATE audit_schedules SET frequency=$1, next_run=$2 WHERE id=$3 RETURNING *`,
      [frequency, await toScheduleRunValue(computeNextRun(frequency)), req.params.id],
    );
    if (!result.rowCount) { res.status(404).json({ error: "not found" }); return; }
    res.json(scheduleToPublic(result.rows[0]));
  } catch {
    res.status(500).json({ error: "Update failed" });
  }
}

async function deleteSchedule(req: Request, res: Response) {
  // Defense in depth: explicit org_id guard in addition to RLS (BUG-F)
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    await req.orgDb(`DELETE FROM audit_schedules WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
}

// (schedule + upcoming GET routes registered earlier, before /:id)
router.post("/audits/schedule",        canWrite,  createSchedule);
router.patch("/audits/schedule/:id",   canWrite,  patchSchedule);
router.delete("/audits/schedule/:id",  canAdmin,  deleteSchedule);
router.get("/audits/schedules",        listSchedules);
router.post("/audits/schedules",       canWrite,  createSchedule);
router.patch("/audits/schedules/:id",  canWrite,  patchSchedule);
router.delete("/audits/schedules/:id", canAdmin,  deleteSchedule);

export default router;
