import { Router, type Request, type Response } from "express";
import { getWorkflowsData, executeWorkflow } from "../services/automation-service.js";
import { store } from "../services/store.js";
import { requireAddon } from "../middlewares/planGate.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// aiWorkflows add-on gates all automation workflow routes
router.use("/automation", requireAddon("aiWorkflows", "AI Automation Workflows"));

router.get("/automation/workflows", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT * FROM automation_workflows WHERE org_id=$1 ORDER BY created_at DESC LIMIT 500`,
      [org(req)]
    );
    if (r.rows.length > 0) {
      const runs = await db(req)(
        `SELECT status, duration_ms FROM workflow_runs WHERE org_id=$1 ORDER BY started_at DESC LIMIT 100`,
        [org(req)]
      ).catch(() => ({ rows: [] }));
      const runRows = runs.rows as Array<Record<string, unknown>>;
      const totalRuns = runRows.length;
      const successRuns = runRows.filter((run: Record<string, unknown>) => run["status"] === "success").length;
      const durations = runRows.map((run: Record<string, unknown>) => Number(run["duration_ms"] ?? 0)).filter(Number.isFinite);
      res.json({
        workflows: r.rows,
        runs: runs.rows,
        stats: {
          totalRuns,
          successRate: totalRuns ? Math.round((successRuns / totalRuns) * 100) : null,
          avgDuration: durations.length ? Math.round(durations.reduce((sum: number, value: number) => sum + value, 0) / durations.length) : null,
        },
      });
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
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { name, icon, description, actions, category } = body as { name?: string; icon?: string; description?: string; actions?: unknown; category?: string };
  // Accept both camelCase (API clients) and snake_case (dashboard frontend)
  const triggerType   = (body.triggerType   ?? body.trigger_type)   as string | undefined;
  const triggerConfig = (body.triggerConfig ?? body.trigger_config) as Record<string, unknown> | undefined;
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
    // Return the created row so the frontend can update its list without a reload
    const created = await db(req)(`SELECT * FROM automation_workflows WHERE id=$1 AND org_id=$2`, [id, org(req)]).catch(() => ({ rows: [] }));
    store.logActivity({ type: "settings", label: `Workflow créé : ${name}`, targetId: id, targetType: "workflow", orgId: org(req) }).catch(() => {});
    res.status(201).json({ ok: true, id, workflow: created.rows[0] ?? null });
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
  const id = String(req.params.id);
  try {
    // Tenant isolation: the workflow must belong to the requesting org before execution
    const owned = await db(req)(
      `SELECT id, enabled FROM automation_workflows WHERE id=$1 AND org_id=$2`,
      [id, org(req)]
    );
    if (owned.rows.length === 0) {
      res.status(404).json({ error: "Workflow not found" }); return;
    }
    if (owned.rows[0]["enabled"] !== true) {
      res.status(409).json({ error: "Workflow désactivé : activez-le avant de l’exécuter." }); return;
    }
    const result = await executeWorkflow(id, org(req));
    if (!result.success) {
      // The workflow exists and is enabled (checked above) — a failure here means
      // execution itself failed, not that the workflow is unavailable.
      // Bug-6 fix: return the real error message from the run, not a generic string.
      const runError = (result as { error?: string }).error
        ?? "L'exécution du workflow a échoué — réessayez ou consultez l'historique des runs.";
      console.error("[automation] workflow run failed", { workflowId: id, orgId: org(req), runId: result.runId, error: runError });
      res.status(500).json({ error: runError, runId: result.runId });
      return;
    }
    store.logActivity({ type: "audit", label: `Workflow exécuté : ${id}`, targetId: id, targetType: "workflow", orgId: org(req) }).catch(err => console.warn("[logActivity]", err?.message));
    store.broadcast({ type: "fp:workflow:completed", workflowId: id }, org(req));
    res.json(result);
  } catch (execErr) {
    const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
    console.error("[automation] executeWorkflow threw", { workflowId: id, orgId: org(req), error: errMsg });
    res.status(500).json({ error: errMsg || "Failed to execute workflow", runId: null });
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
