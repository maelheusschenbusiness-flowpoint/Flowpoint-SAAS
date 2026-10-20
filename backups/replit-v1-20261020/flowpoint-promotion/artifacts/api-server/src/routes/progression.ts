/**
 * GET /api/progression
 * Returns real org-derived stats + achievements derived only from those stats.
 * No random or hardcoded progress values.
 */
import { Router, type Request, type Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { logger } from "../lib/logger.js";
import { computeUserStreak } from "../services/activity-streak.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const orgDb = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

/** Safe integer count from a DB row */
function rowCount(rows: Record<string, unknown>[], col = "c"): number {
  return Number(rows[0]?.[col] ?? 0) || 0;
}

router.get("/progression", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  try {
    const db = orgDb(req);

    // Run all counts in parallel
    const [
      auditsRes,
      avgScoreRes,
      monitorsRes,
      missionsRes,
      reportsRes,
      keywordsRes,
      competitorsRes,
      streak,
    ] = await Promise.all([
      db(`SELECT COUNT(*)::int AS c FROM audits WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] })),
      db(`SELECT ROUND(AVG(score)::numeric, 1) AS avg FROM audits WHERE org_id=$1 AND score IS NOT NULL`, [orgId]).catch(() => ({ rows: [] })),
      db(`SELECT COUNT(*)::int AS c FROM monitors WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] })),
      db(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='done')::int AS done FROM missions WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] })),
      db(`SELECT COUNT(*)::int AS c FROM reports WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] })),
      db(`SELECT COUNT(*)::int AS c FROM tracked_keywords WHERE org_id=$1 AND active=true`, [orgId]).catch(() => ({ rows: [] })),
      db(`SELECT COUNT(*)::int AS c FROM competitors WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] })),
      computeUserStreak(
        db,
        orgId,
        req.orgContext?.userUuid ?? req.orgContext?.userId ?? req.userId ?? undefined,
      ),
    ]);

    const auditsCount      = rowCount(auditsRes.rows);
    const avgScore         = Number(avgScoreRes.rows[0]?.["avg"] ?? 0) || 0;
    const monitorsCount    = rowCount(monitorsRes.rows);
    const missionsTotal    = Number(missionsRes.rows[0]?.["total"] ?? 0) || 0;
    const missionsCompleted = Number(missionsRes.rows[0]?.["done"] ?? 0) || 0;
    const reportsCount     = rowCount(reportsRes.rows);
    const keywordsCount    = rowCount(keywordsRes.rows);
    const competitorsCount = rowCount(competitorsRes.rows);

    // ── Achievements derived only from real counts ─────────────────────────────
    const achievements = [
      {
        key:      "first_audit",
        label:    "Premier audit",
        achieved: auditsCount >= 1,
        progress: Math.min(auditsCount, 1),
        target:   1,
      },
      {
        key:      "five_audits",
        label:    "5 audits réalisés",
        achieved: auditsCount >= 5,
        progress: Math.min(auditsCount, 5),
        target:   5,
      },
      {
        key:      "ten_audits",
        label:    "10 audits réalisés",
        achieved: auditsCount >= 10,
        progress: Math.min(auditsCount, 10),
        target:   10,
      },
      {
        key:      "audit_score_80",
        label:    "Score moyen ≥ 80",
        achieved: avgScore >= 80,
        progress: Math.min(Math.round(avgScore), 80),
        target:   80,
      },
      {
        key:      "first_monitor",
        label:    "Premier moniteur configuré",
        achieved: monitorsCount >= 1,
        progress: Math.min(monitorsCount, 1),
        target:   1,
      },
      {
        key:      "five_monitors",
        label:    "5 moniteurs actifs",
        achieved: monitorsCount >= 5,
        progress: Math.min(monitorsCount, 5),
        target:   5,
      },
      {
        key:      "mission_first",
        label:    "Première mission complétée",
        achieved: missionsCompleted >= 1,
        progress: Math.min(missionsCompleted, 1),
        target:   1,
      },
      {
        key:      "mission_10",
        label:    "10 missions complétées",
        achieved: missionsCompleted >= 10,
        progress: Math.min(missionsCompleted, 10),
        target:   10,
      },
      {
        key:      "first_report",
        label:    "Premier rapport généré",
        achieved: reportsCount >= 1,
        progress: Math.min(reportsCount, 1),
        target:   1,
      },
      {
        key:      "first_keyword",
        label:    "Premier mot-clé suivi",
        achieved: keywordsCount >= 1,
        progress: Math.min(keywordsCount, 1),
        target:   1,
      },
      {
        key:      "keywords_10",
        label:    "10 mots-clés suivis",
        achieved: keywordsCount >= 10,
        progress: Math.min(keywordsCount, 10),
        target:   10,
      },
      {
        key:      "first_competitor",
        label:    "Premier concurrent ajouté",
        achieved: competitorsCount >= 1,
        progress: Math.min(competitorsCount, 1),
        target:   1,
      },
      {
        key:      "streak_3",
        label:    "3 jours consécutifs",
        achieved: streak.current >= 3,
        progress: Math.min(streak.current, 3),
        target:   3,
      },
      {
        key:      "streak_7",
        label:    "7 jours consécutifs",
        achieved: streak.best >= 7,
        progress: Math.min(streak.best, 7),
        target:   7,
      },
      {
        key:      "streak_30",
        label:    "30 jours consécutifs",
        achieved: streak.best >= 30,
        progress: Math.min(streak.best, 30),
        target:   30,
      },
    ];

    res.json({
      auditsCount,
      avgScore,
      monitorsCount,
      missionsCompleted,
      missionsTotal,
      reportsCount,
      keywordsCount,
      competitorsCount,
      streak,
      achievements,
    });
  } catch (err) {
    logger.warn({ err }, "[progression] GET failed");
    res.status(500).json({ error: "Failed to load progression" });
  }
});

export default router;
