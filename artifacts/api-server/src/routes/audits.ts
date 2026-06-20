import { Router, Request, Response } from "express";
import { connectMongo } from "../lib/mongo.js";
import { AuditModel, AuditScheduleModel } from "../models/Audit.js";
import { computeNextRun, isValidFrequency } from "../services/schedule-utils.js";
import { evaluateAlertRulesForAudit } from "../services/monitor-cron.js";
import { store } from "../services/store.js";
import { analyzePSI } from "../services/pagespeed-service.js";
import { reportRateLimit as auditRateLimit } from "../middlewares/rateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/audits", async (_req, res) => {
  try {
    await connectMongo();
    const audits = await AuditModel.find().sort({ date: -1 }).limit(500).lean();
    res.json(audits.map(a => ({ ...a, id: a._id })));
  } catch {
    res.json([]);
  }
});

router.post("/audits", auditRateLimit, async (req, res) => {
  const { url, origin = "manual" } = req.body as { url?: string; origin?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const apiKey = process.env["PAGESPEED_API_KEY"] ?? process.env["GOOGLE_API_KEY"] ?? "";
  if (!apiKey && process.env["NODE_ENV"] === "production") {
    res.status(503).json({ error: "PageSpeed API not configured" }); return;
  }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
  const auditId = `a${Date.now()}`;

  try {
    await connectMongo();
    const audit = await AuditModel.create({
      _id: auditId, url: normalizedUrl, score: 0,
      status: "processing", speed: 0, date: new Date().toISOString(), issues: 0, origin,
    });

    store.logActivity({
      type: "audit", label: `Audit lancé : ${normalizedUrl}`,
      targetId: auditId, targetType: "audit", metadata: { url: normalizedUrl, origin },
    }).catch(() => {});

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

        const score = Math.round(weightedPerf * 0.40 + weightedSeo * 0.30 + weightedA11y * 0.15 + weightedBP * 0.15);
        const status: "ok" | "warn" | "error" = score >= 70 ? "ok" : score >= 50 ? "warn" : "error";
        const speed = d?.scores.performance ?? m?.scores.performance ?? 0;
        const issues = (m?.criticalIssues.length ?? 0) + (d?.criticalIssues.length ?? 0);

        await AuditModel.findByIdAndUpdate(auditId, { $set: { score, status, speed, issues } });
        evaluateAlertRulesForAudit(normalizedUrl, score).catch(() => {});
      } catch {
        await AuditModel.findByIdAndUpdate(auditId, { $set: { status: "error", score: 0 } }).catch(() => {});
      }
    })().catch(() => {});

    res.status(201).json({ ...audit.toJSON(), id: auditId });
  } catch (err) {
    logger.error({ err }, "[audits] POST failed");
    res.status(500).json({ error: "Failed to create audit" });
  }
});

router.delete("/audits/:id", async (req, res) => {
  try {
    await connectMongo();
    await AuditModel.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

router.get("/audits/history", async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  const daysRaw = parseInt((req.query.days as string) || "90", 10);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 90;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    await connectMongo();
    const history = await AuditModel.find({ url, date: { $gte: cutoff } }).sort({ date: 1 }).limit(365).lean();
    res.json(history.map(a => ({ ...a, id: a._id })));
  } catch {
    res.json([]);
  }
});

// ── Schedules ────────────────────────────────────────────────────────────────

async function listSchedules(_req: Request, res: Response) {
  try {
    await connectMongo();
    const schedules = await AuditScheduleModel.find().limit(200).lean();
    res.json(schedules.map(s => ({ ...s, id: s._id })));
  } catch { res.json([]); }
}

async function upcomingSchedules(_req: Request, res: Response) {
  try {
    await connectMongo();
    const schedules = await AuditScheduleModel.find().sort({ nextRun: 1 }).limit(3).lean();
    res.json(schedules.map(s => ({ ...s, id: s._id })));
  } catch { res.json([]); }
}

async function createSchedule(req: Request, res: Response) {
  const { url, frequency = "weekly" } = req.body as { url?: string; frequency?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  if (!isValidFrequency(frequency)) { res.status(400).json({ error: "frequency must be daily, weekly or monthly" }); return; }
  try {
    await connectMongo();
    const updated = await AuditScheduleModel.findOneAndUpdate(
      { url },
      { $set: { frequency, nextRun: computeNextRun(frequency) } },
      { upsert: true, new: true, lean: true },
    );
    res.json({ ...updated, id: updated!._id });
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
    await connectMongo();
    const updated = await AuditScheduleModel.findByIdAndUpdate(
      req.params.id,
      { $set: { frequency, nextRun: computeNextRun(frequency) } },
      { new: true, lean: true },
    );
    res.json({ ...updated, id: updated!._id });
  } catch {
    res.status(500).json({ error: "Update failed" });
  }
}

async function deleteSchedule(req: Request, res: Response) {
  try {
    await connectMongo();
    await AuditScheduleModel.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
}

router.get("/audits/schedule",        listSchedules);
router.get("/audits/upcoming",        upcomingSchedules);
router.post("/audits/schedule",       createSchedule);
router.patch("/audits/schedule/:id",  patchSchedule);
router.delete("/audits/schedule/:id", deleteSchedule);
router.get("/audits/schedules",       listSchedules);
router.post("/audits/schedules",      createSchedule);
router.patch("/audits/schedules/:id", patchSchedule);
router.delete("/audits/schedules/:id",deleteSchedule);

export default router;
