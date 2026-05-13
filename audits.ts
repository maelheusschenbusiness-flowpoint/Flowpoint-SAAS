import { Router, Request, Response } from "express";
import { db, auditsTable, auditSchedulesTable } from "@workspace/db";
import { eq, desc, lte, and, gte } from "drizzle-orm";
import { computeNextRun, isValidFrequency } from "../services/schedule-utils.js";
import { evaluateAlertRulesForAudit } from "../services/monitor-cron.js";
import { store } from "../services/store.js";

const router = Router();

router.get("/audits", async (_req, res) => {
  const audits = await db.select().from(auditsTable).orderBy(desc(auditsTable.date));
  res.json(audits);
});

router.post("/audits", async (req, res) => {
  const { url, origin = "manual" } = req.body as { url?: string; origin?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const statusOptions = ["ok", "warn", "error"] as const;
  const score = Math.floor(Math.random() * 50) + 40;
  const [audit] = await db.insert(auditsTable).values({
    id: `a${Date.now()}`,
    url,
    score,
    status: statusOptions[Math.floor(Math.random() * statusOptions.length)],
    speed: Math.floor(Math.random() * 40) + 50,
    date: new Date().toISOString(),
    issues: Math.floor(Math.random() * 15) + 1,
    origin,
  }).returning();
  // Evaluate custom alert rules for the manual audit (fire-and-forget)
  evaluateAlertRulesForAudit(url, score).catch(() => {});
  store.logActivity({
    type: "audit",
    label: `Audit lancé : ${url}`,
    targetId: audit.id,
    targetType: "audit",
    metadata: { url, score, origin },
  }).catch(() => {});
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
    .orderBy(auditsTable.date);
  res.json(history);
});

// ── Audit Schedules (singular /schedule + plural /schedules aliases) ────────

async function listSchedules(_req: Request, res: Response) {
  const schedules = await db.select().from(auditSchedulesTable);
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
