import { Router, Request, Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { canWrite, canAdmin } from "../middlewares/requireRole.js";
import { pool } from "@workspace/db";
import { computeNextRun, isValidFrequency } from "../services/schedule-utils.js";
import { evaluateAlertRulesForAudit } from "../services/monitor-cron.js";
import { store } from "../services/store.js";
import { analyzePSI } from "../services/pagespeed-service.js";
import { reportRateLimit as auditRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── DB row → public shape ──────────────────────────────────────────────────────
function auditToPublic(row: Record<string, unknown>) {
  return {
    id:        row["id"],
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
  const { url, origin = "manual" } = req.body as { url?: string; origin?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const auditId       = `a${Date.now()}`;
  const dateStr       = new Date().toISOString();

  try {
    // Guard: audit running on same URL for this org today
    // BUG-005 fix: audits.date is TEXT — compare via created_at (TIMESTAMP) to avoid
    // "operator does not exist: text >= timestamp with time zone" PostgreSQL error.
    const dup = await req.orgDb(
      `SELECT id FROM audits WHERE org_id = $1 AND url = $2 AND created_at >= date_trunc('day', now()) LIMIT 1`,
      [orgId, normalizedUrl]
    );
    if (dup.rows.length) {
      res.status(409).json({ error: "Audit déjà lancé aujourd'hui", duplicateId: dup.rows[0].id });
      return;
    }
    await req.orgDb(
      `INSERT INTO audits (id, url, score, status, speed, date, issues, origin, org_id, created_at)
       VALUES ($1,$2,0,'processing',0,$3,0,$4,$5,NOW())`,
      [auditId, normalizedUrl, dateStr, origin, orgId],
    );

    store.logActivity({
      type: "audit", label: `Audit lancé : ${normalizedUrl}`,
      targetId: auditId, targetType: "audit", metadata: { url: normalizedUrl, origin }, orgId,
    }).catch(err => logger.error({ err }, "[audits] logActivity failed"));

    // Async PSI analysis — runs after response is sent.
    // Uses pool (superuser) intentionally: background UPDATE by id, not a cross-org read.
    (async () => {
      try {
        const [mobile, desktop] = await Promise.allSettled([
          analyzePSI(normalizedUrl, "mobile",  orgId),
          analyzePSI(normalizedUrl, "desktop", orgId),
        ]);
        const m = mobile.status  === "fulfilled" ? mobile.value  : null;
        const d = desktop.status === "fulfilled" ? desktop.value : null;
        if (!m && !d) throw new Error("Both PSI requests failed");

        const avg = (mv: number, dv: number, mw: number, dw: number) =>
          m && d ? Math.round(mv * mw + dv * dw) : m ? mv : dv;

        const weightedPerf = avg(m?.scores.performance ?? 0, d?.scores.performance ?? 0, 0.6, 0.4);
        const weightedSeo  = avg(m?.scores.seo          ?? 0, d?.scores.seo          ?? 0, 0.6, 0.4);
        const weightedA11y = avg(m?.scores.accessibility ?? 0, d?.scores.accessibility ?? 0, 0.5, 0.5);
        const weightedBP   = avg(m?.scores.bestPractices ?? 0, d?.scores.bestPractices ?? 0, 0.5, 0.5);

        const score  = Math.round(weightedPerf * 0.40 + weightedSeo * 0.30 + weightedA11y * 0.15 + weightedBP * 0.15);
        const status: "ok" | "warn" | "error" = score >= 70 ? "ok" : score >= 50 ? "warn" : "error";
        const speed  = d?.scores.performance ?? m?.scores.performance ?? 0;
        const issues = (m?.criticalIssues.length ?? 0) + (d?.criticalIssues.length ?? 0);

        // org_id guard: pool runs as postgres (superuser, BYPASSRLS) — RLS bypassed.
        await pool.query(
          `UPDATE audits SET score=$1, status=$2, speed=$3, issues=$4 WHERE id=$5 AND org_id=$6`,
          [score, status, speed, issues, auditId, orgId],
        );
        evaluateAlertRulesForAudit(normalizedUrl, score, orgId).catch(() => {});
        store.broadcast({ type: "audit:complete", auditId, score, status }, orgId);
        store.logActivity({
          type: "audit",
          label: `Audit terminé : ${normalizedUrl} — Score ${score}/100`,
          targetId: auditId,
          targetType: "audit",
          metadata: { url: normalizedUrl, score, status },
          orgId,
        }).catch(err => logger.error({ err }, "[audits] logActivity (complete) failed"));
      } catch {
        await pool.query(
          `UPDATE audits SET status='error', score=0 WHERE id=$1 AND org_id=$2`,
          [auditId, orgId],
        ).catch(() => {});
        store.broadcast({ type: "audit:error", auditId }, orgId);
      }
    })().catch(() => {});

    res.status(201).json({
      id: auditId, url: normalizedUrl, score: 0,
      status: "processing", speed: 0, date: dateStr, issues: 0, origin,
    });
  } catch (err) {
    logger.error({ err }, "[audits] POST failed");
    res.status(500).json({ error: "Failed to create audit" });
  }
});

// ── GET /audits/history ───────────────────────────────────────────────────────
// Must be registered BEFORE /:id so Express doesn't match "history" as an id.

router.get("/audits/history", async (req: Request, res: Response) => {
  const url     = req.query.url as string | undefined;
  const daysRaw = parseInt((req.query.days as string) || "90", 10);
  const days    = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
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
  try {
    const result = await req.orgDb(
      `SELECT * FROM audits WHERE id = $1 LIMIT 1`,
      [req.params.id],
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
    const result = await req.orgDb(
      `SELECT * FROM audit_schedules WHERE enabled = true ORDER BY next_run ASC LIMIT 3`,
    );
    res.json(result.rows.map(scheduleToPublic));
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
  const nextRun = computeNextRun(frequency);
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
      result = await req.orgDb(
        `INSERT INTO audit_schedules (id, url, frequency, next_run, enabled, org_id, created_at)
         VALUES ($1,$2,$3,$4,true,$5,NOW()) RETURNING *`,
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
      [frequency, computeNextRun(frequency), req.params.id],
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
