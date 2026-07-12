import { Router, type Request, type Response } from "express";
import { getWorkflowsData, executeWorkflow } from "../services/automation-service.js";
import { store } from "../services/store.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.get("/automation/workflows", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT * FROM automation_workflows WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [org(req)]
    );
    if (r.rows.length > 0) {
      res.json({ workflows: r.rows, runs: [], stats: { totalRuns: 0, successRate: 100, avgDuration: 0 } });
      return;
    }
    const data = await getWorkflowsData(org(req));
    res.json(data);
  } catch {
    // Fallback: DB unavailable or table missing — return empty state, never 500
    try {
      const data = await getWorkflowsData("default");
      res.json(data);
    } catch {
      res.json({ workflows: [], runs: [], stats: { active: 0, totalRuns: 0, successRate: 0, avgDuration: 0 } });
    }
  }
});

router.post("/automation/workflows", async (req: Request, res: Response) => {
  const { name, icon, description, triggerType, triggerConfig, actions, category } = req.body ?? {};
  if (!name || !triggerType || !actions) {
    res.status(400).json({ error: "name, triggerType, actions required" }); return;
  }
  const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO automation_workflows (id, org_id, name, icon, description, trigger_type, trigger_config, actions, enabled, runs_count, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,0,$9)`,
      [id, org(req), name, icon ?? "⚡", description ?? null, triggerType,
       JSON.stringify(triggerConfig ?? {}), JSON.stringify(actions), category ?? "general"]
    );
    res.status(201).json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "Failed to create workflow" });
  }
});

router.patch("/automation/workflows/:id", async (req: Request, res: Response) => {
  const { enabled, name, triggerConfig, actions } = req.body ?? {};
  const setClauses: string[] = ["updated_at=now()"];
  const params: unknown[] = [];

  if (enabled  !== undefined) { params.push(enabled);                   setClauses.push(`enabled=$${params.length}`); }
  if (name)                   { params.push(name);                      setClauses.push(`name=$${params.length}`); }
  if (triggerConfig)          { params.push(JSON.stringify(triggerConfig)); setClauses.push(`trigger_config=$${params.length}`); }
  if (actions)                { params.push(JSON.stringify(actions));   setClauses.push(`actions=$${params.length}`); }

  params.push(req.params.id, org(req));
  try {
    await db(req)(
      `UPDATE automation_workflows SET ${setClauses.join(",")} WHERE id=$${params.length - 1} AND org_id=$${params.length}`,
      params
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update workflow" });
  }
});

router.post("/automation/workflows/:id/run", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await executeWorkflow(id);
    store.logActivity({ type: "audit", label: `Workflow exécuté : ${id}`, targetId: id, targetType: "workflow" }).catch(err => console.warn("[logActivity]", err?.message));
    store.broadcast({ type: "fp:workflow:completed", workflowId: id, durationMs: result?.durationMs });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to execute workflow" });
  }
});

router.delete("/automation/workflows/:id", async (req: Request, res: Response) => {
  try {
    await db(req)(`DELETE FROM automation_workflows WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete workflow" });
  }
});

router.get("/automation/runs", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT id, workflow_id, org_id, status, started_at, completed_at, error, output
       FROM workflow_runs
       WHERE org_id = $1
       ORDER BY started_at DESC LIMIT 50`,
      [org(req)]
    );
    res.json({ runs: r.rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to fetch runs", detail: msg });
  }
});

export default router;
