import { Router, Request, Response } from "express";
import { db, auditsTable, auditSchedulesTable } from "@workspace/db";
import { eq, desc, lte, and, gte } from "drizzle-orm";
import { computeNextRun, isValidFrequency } from "../services/schedule-utils.js";
import { evaluateAlertRulesForAudit } from "../services/monitor-cron.js";
import { store } from "../services/store.js";
import { analyzePSI } from "../services/pagespeed-service.js";
import { reportRateLimit as auditRateLimit } from "../middlewares/rateLimiter.js";

const router = Router();

router.get("/audits", async (_req, res) => {
  try {
    const audits = await db.select().from(auditsTable).orderBy(desc(auditsTable.date)).limit(500);
    res.json(audits);
  } catch {
    res.json([]);
  }
});

router.post("/audits", auditRateLimit, async (req, res) => {
  const { url, origin = "manual" } = req.body as { url?: string; origin?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  // Production guard — real API key required; never fall back to random scores
  const apiKey = process.env["PAGESPEED_API_KEY"] ?? process.env["GOOGLE_API_KEY"] ?? "";
  if (!apiKey && process.env["NODE_ENV"] === "production") {
    res.status(503).json({ error: "PageSpeed API not configured" });
    return;
  }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";

  // Insert immediately as "processing" so the UI can show a pending state.
  // Real PSI score (mobile + desktop weighted composite) is written back async.
  const [audit] = await db.insert(auditsTable).values({
    id: `a${Date.now()}`,
    url: normalizedUrl,
    score: 0,
    status: "processing",
    speed: 0,
    date: new Date().toISOString(),
    issues: 0,
    origin,
  }).returning();

  store.logActivity({
    type: "audit",
    label: `Audit lancé : ${normalizedUrl}`,
    targetId: audit.id,
    targetType: "audit",
    metadata: { url: normalizedUrl, origin },
  }).catch(() => {});

  // Run mobile + desktop PSI in parallel — same composite formula as audit-worker.
  (async () => {
    try {
      const [mobile, desktop] = await Promise.allSettled([
        analyzePSI(normalizedUrl, "mobile",  orgId),
        analyzePSI(normalizedUrl, "desktop", orgId),
      ]);

      const m = mobile.status  === "fulfilled" ? mobile.value  : null;
      const d = desktop.status === "fulfilled" ? desktop.value : null;

      if (!m && !d) throw new Error("Both mobile and desktop PSI requests failed");

      const avg = (mv: number, dv: number, mw: number, dw: number) =>
        m && d ? Math.round(mv * mw + dv * dw) : m ? mv : dv;

      const weightedPerf = avg(m?.scores.performance ?? 0, d?.scores.performance ?? 0, 0.6, 0.4);
      const weightedSeo  = avg(m?.scores.seo          ?? 0, d?.scores.seo          ?? 0, 0.6, 0.4);
      const weightedA11y = avg(m?.scores.accessibility ?? 0, d?.scores.accessibility ?? 0, 0.5, 0.5);
      const weightedBP   = avg(m?.scores.bestPractices ?? 0, d?.scores.bestPractices ?? 0, 0.5, 0.5);

      // Composite: perf 40%, SEO 30%, a11y 15%, best-practices 15%
      const score = Math.round(
        weightedPerf * 0.40 +
        weightedSeo  * 0.30 +
        weightedA11y * 0.15 +
        weightedBP   * 0.15
      );

      const status: "ok" | "warn" | "error" = score >= 70 ? "ok" : score >= 50 ? "warn" : "error";
      const speed = d?.scores.performance ?? m?.scores.performance ?? 0;
      const issues = (m?.criticalIssues.length ?? 0) + (d?.criticalIssues.length ?? 0);

      await db.update(auditsTable)
        .set({ score, status, speed, issues })
        .where(eq(auditsTable.id, audit.id));

      evaluateAlertRulesForAudit(normalizedUrl, score).catch(() => {});
    } catch {
      // PSI unreachable — mark failed rather than leaving "processing" forever
      await db.update(auditsTable)
        .set({ status: "error", score: 0 })
        .where(eq(auditsTable.id, audit.id))
        .catch(() => {});
    }
  })().catch(() => {});

  res.status(201).json(audit);
});

router.delete("/audits/:id", async (req, res) => {
  await db.delete(auditsTable).where(eq(auditsTable.id, req.params.id));
  res.json({ ok: true });
});

router.get("/audits/history", async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  const daysRaw = parseInt((req.query.days as string) || "90", 10);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const history = await db.select().from(auditsTable)
    .where(and(eq(auditsTable.url, url), gte(auditsTable.date, cutoff)))
    .orderBy(auditsTable.date).limit(365);
  res.json(history);
});

// ── Audit Schedules (singular /schedule + plural /schedules aliases) ────────

async function listSchedules(_req: Request, res: Response) {
  const schedules = await db.select().from(auditSchedulesTable).limit(200);
  res.json(schedules);
}

async function upcomingSchedules(_req: Request, res: Response) {
  const schedules = await db
    .select()
    .from(auditSchedulesTable)
    .orderBy(auditSchedulesTable.nextRun)
    .limit(3);
  res.json(schedules);
}

async function createSchedule(req: Request, res: Response) {
  const { url, frequency = "weekly" } = req.body as { url?: string; frequency?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  if (!isValidFrequency(frequency)) { res.status(400).json({ error: "frequency must be daily, weekly or monthly" }); return; }

  const existing = await db.select().from(auditSchedulesTable).where(eq(auditSchedulesTable.url, url)).limit(1);
  if (existing.length > 0) {
    const [updated] = await db.update(auditSchedulesTable)
      .set({ frequency, nextRun: computeNextRun(frequency) })
      .where(eq(auditSchedulesTable.url, url))
      .returning();
    res.json(updated);
    return;
  }

  const now = Date.now();
  const [schedule] = await db.insert(auditSchedulesTable).values({
    id: `sched_${Date.now()}`,
    url,
    frequency,
    nextRun: computeNextRun(frequency),
    createdAt: now,
  }).returning();
  res.status(201).json(schedule);
}

async function patchSchedule(req: Request, res: Response) {
  const { frequency } = req.body as { frequency?: string };
  const updates: Record<string, unknown> = {};
  if (frequency) {
    if (!isValidFrequency(frequency)) { res.status(400).json({ error: "frequency must be daily, weekly or monthly" }); return; }
    updates.frequency = frequency; updates.nextRun = computeNextRun(frequency);
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "nothing to update" }); return; }
  const [updated] = await db.update(auditSchedulesTable)
    .set(updates)
    .where(eq(auditSchedulesTable.id, req.params.id))
    .returning();
  res.json(updated);
}

async function deleteSchedule(req: Request, res: Response) {
  await db.delete(auditSchedulesTable).where(eq(auditSchedulesTable.id, req.params.id));
  res.json({ ok: true });
}

// Singular routes (spec-compliant)
router.get("/audits/schedule", listSchedules);
router.get("/audits/upcoming", upcomingSchedules);
router.post("/audits/schedule", createSchedule);
router.patch("/audits/schedule/:id", patchSchedule);
router.delete("/audits/schedule/:id", deleteSchedule);

// Plural aliases (backward compat)
router.get("/audits/schedules", listSchedules);
router.post("/audits/schedules", createSchedule);
router.patch("/audits/schedules/:id", patchSchedule);
router.delete("/audits/schedules/:id", deleteSchedule);

export default router;
