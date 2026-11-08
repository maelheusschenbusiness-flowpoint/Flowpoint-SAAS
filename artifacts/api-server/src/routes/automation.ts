import { Router, type Request, type Response } from "express";
import { getWorkflowsData, executeWorkflow } from "../services/automation-service.js";
import { store } from "../services/store.js";
import { requireAddon, requireQuota } from "../middlewares/planGate.js";
import { hasAddonEntitlementForOrg } from "../services/addon-entitlement.js";
import { isAWLReportWorkflow } from "../services/awl-weekly-report.js";
import { EMITTED_EVENTS, EXECUTABLE_WORKFLOW_ACTIONS, describeWorkflowCapability, isEmittedEvent, isExecutableWorkflowAction, normalizeAutomationEvent } from "../services/automation-capabilities.js";

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
        workflows: r.rows.map(w => ({ ...w, capability: describeWorkflowCapability(w) })),
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
    // An org-scoped read failure must never retry against the shared tenant.
    res.status(503).json({
      error: "Les workflows sont temporairement indisponibles.",
      workflows: [],
      runs: [],
      stats: { active: 0, totalRuns: 0, successRate: null, avgDuration: null },
    });
  }
});

// Plafond d'automatisations du plan (3 / 20 / 100) : compte les workflows de l'organisation.
// Les workflows existants restent utilisables ; seule la CREATION au-dela du plafond est refusee.
router.post("/automation/workflows", requireQuota("automations", async (orgId, quotaReq) => {
  const r = await (quotaReq as OrgReq).orgDb(`SELECT COUNT(*)::int AS n FROM automation_workflows WHERE org_id=$1`, [orgId]);
  return Number(r.rows[0]?.["n"] ?? 0);
}), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { name, icon, description, actions, category } = body as { name?: string; icon?: string; description?: string; actions?: unknown; category?: string };
  // Accept both camelCase (API clients) and snake_case (dashboard frontend)
  const triggerType   = (body.triggerType   ?? body.trigger_type)   as string | undefined;
  const triggerConfig = (body.triggerConfig ?? body.trigger_config) as Record<string, unknown> | undefined;
  if (!name || !triggerType || !actions) {
    res.status(400).json({ error: "name, triggerType, actions required" }); return;
  }
  // D-07 : un workflow ne peut etre cree qu'avec un declencheur reellement emis et des actions
  // reellement executables ; sinon il resterait « actif » sans jamais rien faire.
  let normalizedTriggerConfig = triggerConfig;
  if (triggerType === "event") {
    const ev = normalizeAutomationEvent(triggerConfig?.event);
    if (!isEmittedEvent(ev)) {
      res.status(400).json({
        error: "Ce déclencheur n'est pas encore actif : aucun événement correspondant n'est émis par FlowPoint.",
        code: "TRIGGER_NOT_SUPPORTED", supported: EMITTED_EVENTS,
      }); return;
    }
    normalizedTriggerConfig = { ...(triggerConfig ?? {}), event: ev };
  }
  if (triggerType === "schedule" && typeof triggerConfig?.cron !== "string") {
    res.status(400).json({ error: "Un workflow planifié exige une expression cron.", code: "TRIGGER_NOT_SUPPORTED" }); return;
  }
  if (triggerType !== "event" && triggerType !== "schedule") {
    res.status(400).json({ error: "Ce type de déclencheur n'est pas encore actif.", code: "TRIGGER_NOT_SUPPORTED", supported: EMITTED_EVENTS }); return;
  }
  const actionList = Array.isArray(actions) ? actions as Array<{ type?: unknown; params?: unknown }> : [];
  const badActions = actionList.filter(a => !isExecutableWorkflowAction(a?.type, a?.params)).map(a => String(a?.type ?? "?"));
  if (!actionList.length || badActions.length) {
    res.status(400).json({
      error: `Action(s) non disponible(s) pour l'instant : ${badActions.join(", ") || "aucune action"}.`,
      code: "ACTION_NOT_SUPPORTED", supported: EXECUTABLE_WORKFLOW_ACTIONS,
    }); return;
  }
  if (isAWLReportWorkflow({ triggerConfig, actions })) {
    try {
      if (!(await hasAddonEntitlementForOrg(org(req), "aiWorkspaceLaunch"))) {
        res.status(402).json({ code: "ADDON_REQUIRED", addonKey: "aiWorkspaceLaunch" }); return;
      }
    } catch {
      res.status(503).json({ error: "Subscription status unavailable. Please try again." }); return;
    }
  }
  const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO automation_workflows (id, org_id, name, icon, description, trigger_type, trigger_config, actions, enabled, runs_count, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,0,$9)`,
      [id, org(req), name, icon ?? "⚡", description ?? null, triggerType,
       JSON.stringify(normalizedTriggerConfig ?? {}), JSON.stringify(actions), category ?? "general"]
    );
    // Return the created row so the frontend can update its list without a reload
    const created = await db(req)(`SELECT * FROM automation_workflows WHERE id=$1 AND org_id=$2`, [id, org(req)]).catch(() => ({ rows: [] }));
    const _awCtx = (req as any).orgContext || {};
    store.logActivity({ type: "settings", label: `Workflow créé : ${name}`, targetId: id, targetType: "workflow", orgId: org(req),
      actionKey: "activity.workflow.created", actionParams: { name: String(name) },
      userId: _awCtx.userId || _awCtx.email || null, userName: _awCtx.name || _awCtx.email || null }).catch(() => {});
    res.status(201).json({ ok: true, id, workflow: created.rows[0] ?? null });
  } catch {
    res.status(500).json({ error: "Failed to create workflow" });
  }
});

router.patch("/automation/workflows/:id", async (req: Request, res: Response) => {
  const { enabled, name, triggerConfig, actions } = req.body ?? {};
  const orgId = org(req);
  let existing: Record<string, unknown> | undefined;
  try {
    const owned = await db(req)(
      `SELECT id, trigger_type, trigger_config, actions FROM automation_workflows WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [req.params.id, orgId],
    );
    existing = owned.rows[0];
  } catch {
    res.status(503).json({ error: "Workflow indisponible." }); return;
  }
  if (!existing) { res.status(404).json({ error: "Workflow not found" }); return; }
  if (enabled === true) {
    const cap = describeWorkflowCapability({
      trigger_type: existing["trigger_type"],
      trigger_config: triggerConfig ?? existing["trigger_config"],
      actions: actions ?? existing["actions"],
    });
    if (!cap.supported) {
      res.status(409).json({
        error: "Ce workflow ne peut pas être activé : son déclencheur ou certaines actions ne sont pas encore disponibles.",
        code: "WORKFLOW_NOT_SUPPORTED", capability: cap,
      }); return;
    }
  }
  if (isAWLReportWorkflow({
    triggerConfig: triggerConfig ?? existing["trigger_config"],
    actions: actions ?? existing["actions"],
  })) {
    try {
      if (!(await hasAddonEntitlementForOrg(orgId, "aiWorkspaceLaunch"))) {
        res.status(402).json({ code: "ADDON_REQUIRED", addonKey: "aiWorkspaceLaunch" }); return;
      }
    } catch {
      res.status(503).json({ error: "Subscription status unavailable. Please try again." }); return;
    }
  }
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
    const _arCtx = (req as any).orgContext || {};
    store.logActivity({ type: "audit", label: `Workflow exécuté : ${id}`, targetId: id, targetType: "workflow", orgId: org(req),
      actionKey: "activity.workflow.run", actionParams: { id: String(id) },
      userId: _arCtx.userId || _arCtx.email || null, userName: _arCtx.name || _arCtx.email || null }).catch(err => console.warn("[logActivity]", err?.message));
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
    const existing = await db(req)(
      `SELECT trigger_config, actions FROM automation_workflows WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [req.params.id, org(req)],
    );
    if (!existing.rows[0]) { res.status(404).json({ error: "Workflow not found" }); return; }
    if (isAWLReportWorkflow({ triggerConfig: existing.rows[0]["trigger_config"], actions: existing.rows[0]["actions"] }) &&
        !(await hasAddonEntitlementForOrg(org(req), "aiWorkspaceLaunch"))) {
      res.status(402).json({ code: "ADDON_REQUIRED", addonKey: "aiWorkspaceLaunch" }); return;
    }
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
