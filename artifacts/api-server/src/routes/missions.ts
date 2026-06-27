import { Router, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";
import { runMissionEngine, getMissionsStats } from "../services/mission-engine.js";

const router = Router();

type OrgReq = Request & { orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; orgId?: string };

function uid(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function orgId(req: Request): string {
  return (req as OrgReq).orgId || "default";
}

function orgDb(req: Request) {
  return (req as OrgReq).orgDb.bind(req);
}

function rowToMission(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    type: row.type,
    priority: row.priority,
    priorityScore: row.priority_score,
    status: row.status,
    impact: row.impact,
    effort: row.effort,
    estimatedTrafficImpact: row.estimated_traffic_impact,
    estimatedRevenueImpact: row.estimated_revenue_impact,
    estimatedSeoImpact: row.estimated_seo_impact,
    estimatedConversionImpact: row.estimated_conversion_impact,
    difficultyScore: row.difficulty_score,
    businessImpactScore: row.business_impact_score,
    aiExplanation: row.ai_explanation,
    aiActionSteps: row.ai_action_steps,
    aiQuickWin: row.ai_quick_win,
    aiReasoning: row.ai_reasoning,
    aiSummary: row.ai_summary,
    sourceType: row.source_type,
    sourceData: row.source_data,
    steps: row.steps || [],
    dueDate: row.due_date,
    date: row.due_date,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
    lastRefreshedAt: row.last_refreshed_at,
    history: row.history || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function logHistory(
  db: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  missionId: string, org: string, action: string,
  fromStatus: string | null, toStatus: string | null
): Promise<void> {
  await db(
    `INSERT INTO mission_history (id, mission_id, org_id, action, from_status, to_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [`mh_${Date.now()}`, missionId, org, action, fromStatus, toStatus]
  ).catch(() => {});
}

// GET /missions
router.get("/missions", async (req: Request, res: Response) => {
  try {
    const db = orgDb(req);
    const org = orgId(req);
    const { status, category, priority, quick_win, limit = "100", offset = "0" } = req.query as Record<string, string>;

    let query = `SELECT * FROM missions WHERE org_id = $1`;
    const params: unknown[] = [org];
    let p = 2;

    if (status && status !== "all") { query += ` AND status = $${p++}`; params.push(status); }
    if (category) { query += ` AND category = $${p++}`; params.push(category); }
    if (priority) { query += ` AND priority = $${p++}`; params.push(priority); }
    if (quick_win === "true") { query += ` AND ai_quick_win = true`; }

    query += ` ORDER BY priority_score DESC, created_at DESC LIMIT $${p++} OFFSET $${p++}`;
    params.push(parseInt(limit) || 100, parseInt(offset) || 0);

    const result = await db(query, params);
    res.json(result.rows.map(rowToMission));
  } catch (err) {
    logger.error({ err }, "[Missions] GET /missions error");
    res.json([]);
  }
});

// GET /missions/stats
router.get("/missions/stats", async (req: Request, res: Response) => {
  try {
    res.json(await getMissionsStats(orgId(req)));
  } catch (err) {
    logger.error({ err }, "[Missions] stats error");
    res.json({ total: 0, todo: 0, inProgress: 0, done: 0, dismissed: 0 });
  }
});

// GET /missions/quick-wins
router.get("/missions/quick-wins", async (req: Request, res: Response) => {
  try {
    const result = await orgDb(req)(
      `SELECT * FROM missions WHERE org_id = $1 AND ai_quick_win = true AND status = 'todo'
       ORDER BY priority_score DESC LIMIT 5`,
      [orgId(req)]
    );
    res.json(result.rows.map(rowToMission));
  } catch {
    res.json([]);
  }
});

// GET /missions/roadmap
router.get("/missions/roadmap", async (req: Request, res: Response) => {
  try {
    const result = await orgDb(req)(
      `SELECT * FROM missions WHERE org_id = $1 AND status NOT IN ('done','dismissed','stale')
       ORDER BY due_date ASC NULLS LAST, priority_score DESC LIMIT 50`,
      [orgId(req)]
    );
    const missions = result.rows.map(rowToMission);
    const week = new Date(Date.now() + 7 * 86400000);
    const month = new Date(Date.now() + 30 * 86400000);
    res.json({
      thisWeek:  missions.filter(m => m.dueDate && new Date(m.dueDate as string) <= week),
      thisMonth: missions.filter(m => m.dueDate && new Date(m.dueDate as string) > week && new Date(m.dueDate as string) <= month),
      later:     missions.filter(m => !m.dueDate || new Date(m.dueDate as string) > month),
    });
  } catch {
    res.json({ thisWeek: [], thisMonth: [], later: [] });
  }
});

// GET /missions/logs
router.get("/missions/logs", async (req: Request, res: Response) => {
  try {
    const result = await orgDb(req)(
      `SELECT * FROM mission_ai_logs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [orgId(req)]
    );
    res.json(result.rows);
  } catch {
    res.json([]);
  }
});

// GET /missions/:id
router.get("/missions/:id", async (req: Request, res: Response) => {
  try {
    const result = await orgDb(req)(
      `SELECT m.*,
        (SELECT json_agg(h ORDER BY h.created_at DESC) FROM mission_history h WHERE h.mission_id = m.id) as history
       FROM missions m WHERE m.id = $1 AND m.org_id = $2`,
      [req.params.id, orgId(req)]
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Mission not found" }); return; }
    res.json(rowToMission(result.rows[0]));
  } catch {
    res.status(500).json({ error: "Database error" });
  }
});

// POST /missions/generate — trigger AI Mission Engine
router.post("/missions/generate", async (req: Request, res: Response) => {
  try {
    const result = await runMissionEngine(orgId(req), "manual");
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "[Missions] generate error");
    res.status(500).json({ error: "Mission engine error" });
  }
});

// POST /missions — create manual mission
router.post("/missions", async (req: Request, res: Response) => {
  try {
    const db = orgDb(req);
    const org = orgId(req);
    const {
      title, description, category = "seo", type = "seo", status = "todo",
      impact = "Moyen", effort = "Moyen", priority = "medium",
      dueDate, steps, priorityScore,
    } = req.body as Record<string, unknown>;

    if (!title) { res.status(400).json({ error: "title required" }); return; }

    const id = uid();
    const pScore = Number(priorityScore) || ({ critical: 90, high: 75, medium: 50, low: 25 }[(priority as string)] ?? 50);

    await db(`
      INSERT INTO missions (
        id, org_id, title, description, category, type, priority, priority_score,
        status, impact, effort, steps, due_date, source_type, created_at, updated_at, last_refreshed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',NOW(),NOW(),NOW())
    `, [id, org, title, description || null, category, type, priority, pScore, status, impact, effort,
        JSON.stringify(steps || []), (dueDate as string) || null]);

    const row = await db(`SELECT * FROM missions WHERE id = $1 AND org_id = $2`, [id, org]);
    const mission = rowToMission(row.rows[0]);

    await logHistory(db, id, org, "created", null, status as string);
    await store.logActivity({
      type: "report", label: `Mission créée : ${title}`,
      targetId: id, targetType: "mission",
      metadata: { category, impact },
    }).catch(() => {});

    res.status(201).json(mission);
  } catch (err) {
    logger.error({ err }, "[Missions] POST error");
    res.status(500).json({ error: "Database error" });
  }
});

// PATCH /missions/:id
router.patch("/missions/:id", async (req: Request, res: Response) => {
  try {
    const db = orgDb(req);
    const org = orgId(req);
    const { id } = req.params;

    const existing = await db(`SELECT * FROM missions WHERE id = $1 AND org_id = $2`, [id, org]);
    if (!existing.rows[0]) { res.status(404).json({ error: "Mission not found" }); return; }
    const prev = existing.rows[0];

    const {
      title, description, status, impact, effort, category, priority,
      steps, dueDate, priorityScore,
    } = req.body as Record<string, unknown>;

    const newStatus = (status as string) || (prev.status as string);
    const isNowDone      = newStatus === "done"      && prev.status !== "done";
    const isNowDismissed = newStatus === "dismissed" && prev.status !== "dismissed";

    await db(`
      UPDATE missions SET
        title        = COALESCE($1, title),
        description  = COALESCE($2, description),
        status       = $3,
        impact       = COALESCE($4, impact),
        effort       = COALESCE($5, effort),
        category     = COALESCE($6, category),
        priority     = COALESCE($7, priority),
        steps        = COALESCE($8::jsonb, steps),
        due_date     = COALESCE($9, due_date),
        priority_score = COALESCE($10, priority_score),
        completed_at = CASE WHEN $11 THEN NOW() ELSE completed_at END,
        dismissed_at = CASE WHEN $12 THEN NOW() ELSE dismissed_at END,
        updated_at   = NOW()
      WHERE id = $13 AND org_id = $14
    `, [
      title || null, description || null, newStatus,
      impact || null, effort || null, category || null, priority || null,
      steps ? JSON.stringify(steps) : null,
      (dueDate as string) || null,
      priorityScore ? Number(priorityScore) : null,
      isNowDone, isNowDismissed,
      id, org,
    ]);

    const row = await db(`SELECT * FROM missions WHERE id = $1 AND org_id = $2`, [id, org]);
    const mission = rowToMission(row.rows[0]);

    if (newStatus !== prev.status) {
      await logHistory(db, id, org, "status_changed", prev.status as string, newStatus);
      if (isNowDone) {
        await store.logActivity({
          type: "report", label: `Mission accomplie : ${prev.title}`,
          targetId: id, targetType: "mission",
          metadata: { category: prev.category, impact: prev.impact },
        }).catch(() => {});
      }
    }

    res.json(mission);
  } catch (err) {
    logger.error({ err }, "[Missions] PATCH error");
    res.status(500).json({ error: "Database error" });
  }
});

// DELETE /missions/:id
router.delete("/missions/:id", async (req: Request, res: Response) => {
  try {
    const db = orgDb(req);
    const org = orgId(req);
    const existing = await db(
      `SELECT title, category FROM missions WHERE id = $1 AND org_id = $2`,
      [req.params.id, org]
    );
    if (!existing.rows[0]) { res.status(404).json({ error: "Mission not found" }); return; }

    await db(`DELETE FROM missions WHERE id = $1 AND org_id = $2`, [req.params.id, org]);
    await db(`DELETE FROM mission_history WHERE mission_id = $1`, [req.params.id]);

    await store.logActivity({
      type: "report", label: `Mission supprimée : ${existing.rows[0].title}`,
      targetId: req.params.id, targetType: "mission",
      metadata: { category: existing.rows[0].category },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// PATCH /missions/:id/steps/:stepId
router.patch("/missions/:id/steps/:stepId", async (req: Request, res: Response) => {
  try {
    const db = orgDb(req);
    const org = orgId(req);
    const row = await db(
      `SELECT steps FROM missions WHERE id = $1 AND org_id = $2`,
      [req.params.id, org]
    );
    if (!row.rows[0]) { res.status(404).json({ error: "Mission not found" }); return; }

    const steps = (row.rows[0].steps || []) as Array<{ id: string; title: string; done: boolean }>;
    const step = steps.find(s => s.id === req.params.stepId);
    if (!step) { res.status(404).json({ error: "Step not found" }); return; }
    if (req.body.done !== undefined) step.done = Boolean(req.body.done);
    if (req.body.title) step.title = req.body.title;

    await db(
      `UPDATE missions SET steps = $1::jsonb, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [JSON.stringify(steps), req.params.id, org]
    );
    res.json({ ok: true, steps });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
