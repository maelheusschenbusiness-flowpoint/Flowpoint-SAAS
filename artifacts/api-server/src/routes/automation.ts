import { Router, type Request, type Response } from "express";
import { getWorkflowsData, executeWorkflow, ensureDefaultWorkflows } from "../services/automation-service.js";
import { db, automationWorkflowsTable, workflowRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";

const router = Router();

router.get("/automation/workflows", async (_req: Request, res: Response) => {
  try {
    const data = await getWorkflowsData();
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch workflows" });
  }
});

router.post("/automation/workflows", async (req: Request, res: Response) => {
  const { name, icon, description, triggerType, triggerConfig, actions, category } = req.body ?? {};
  if (!name || !triggerType || !actions) {
    res.status(400).json({ error: "name, triggerType, actions required" }); return;
  }
  try {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(automationWorkflowsTable).values({
      id,
      orgId: "default",
      name,
      icon: icon ?? "⚡",
      description,
      triggerType,
      triggerConfig: triggerConfig ?? {},
      actions,
      enabled: true,
      runsCount: 0,
      category: category ?? "general",
    });
    res.status(201).json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "Failed to create workflow" });
  }
});

router.patch("/automation/workflows/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { enabled, name, triggerConfig, actions } = req.body ?? {};
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (enabled !== undefined) updates.enabled = enabled;
    if (name) updates.name = name;
    if (triggerConfig) updates.triggerConfig = triggerConfig;
    if (actions) updates.actions = actions;
    await db.update(automationWorkflowsTable).set(updates).where(eq(automationWorkflowsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update workflow" });
  }
});

router.post("/automation/workflows/:id/run", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await executeWorkflow(id);
    store.logActivity({ type: "audit", label: `Workflow exécuté : ${id}`, targetId: id, targetType: "workflow" }).catch(() => {});
    store.broadcast({ type: "fp:workflow:completed", workflowId: id, durationMs: result?.durationMs });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to execute workflow" });
  }
});

router.delete("/automation/workflows/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await db.delete(automationWorkflowsTable).where(eq(automationWorkflowsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete workflow" });
  }
});

router.get("/automation/runs", async (_req: Request, res: Response) => {
  try {
    const { pool } = await import("@workspace/db");
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, workflow_id, status, started_at, ended_at, duration_ms,
                steps_completed, steps_failed, error, output, metadata
         FROM workflow_runs
         ORDER BY started_at DESC
         LIMIT 50`
      );
      res.json({ runs: result.rows });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch runs" });
  }
});

export default router;
