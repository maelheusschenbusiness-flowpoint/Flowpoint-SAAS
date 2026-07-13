import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import crypto from "crypto";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import {
  createIntegration, dispatchEvent, testIntegration, getIntegrationStats,
  processIncomingWebhook, getIntegrationLimit, SUPPORTED_EVENTS,
} from "../services/integrations-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org  = (req: Request): string => (req as OrgReq).orgId ?? "default";
const plan = (req: Request): string => ((req as unknown as { me?: { plan?: string } }).me?.plan ?? "Pro");
const db   = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// ── GET /api/integrations ──────────────────────────────────────────────────────
router.get("/integrations", requireAdmin, async (req, res) => {
  const { platform, active } = req.query as Record<string, string>;
  try {
    let query = `SELECT * FROM automation_integrations WHERE org_id=$1`;
    const params: unknown[] = [org(req)];
    if (platform) { params.push(platform); query += ` AND platform=$${params.length}`; }
    if (active !== undefined) { params.push(active === "true"); query += ` AND active=$${params.length}`; }
    query += ` ORDER BY created_at DESC`;
    const r = await db(req)(query, params);
    res.json({ integrations: r.rows, count: r.rows.length });
  } catch {
    res.json({ integrations: [], count: 0 });
  }
});

// ── GET /api/integrations/stats ────────────────────────────────────────────────
router.get("/integrations/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await getIntegrationStats(org(req));
    res.json({ ...stats, limit: getIntegrationLimit(plan(req)), plan: plan(req), events: SUPPORTED_EVENTS });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// ── GET /api/integrations/templates ────────────────────────────────────────────
router.get("/integrations/templates", async (req, res) => {
  try {
    const r = await db(req)(`SELECT * FROM automation_templates WHERE active=true ORDER BY popularity DESC`);
    res.json({ templates: r.rows, count: r.rows.length });
  } catch {
    res.json({ templates: [], count: 0 });
  }
});

// ── GET /api/integrations/events ───────────────────────────────────────────────
router.get("/integrations/events", (_req, res) => {
  res.json({ events: SUPPORTED_EVENTS });
});

// ── GET /api/integrations/automation-logs ─────────────────────────────────────
router.get("/integrations/automation-logs", requireAdmin, async (req, res) => {
  const { integration_id, level, limit: lim = "50" } = req.query as Record<string, string>;
  try {
    let query = `SELECT al.*, ai.name as integration_name, ai.platform as integration_platform
                 FROM automation_logs al
                 LEFT JOIN automation_integrations ai ON ai.id = al.integration_id
                 WHERE al.org_id=$1`;
    const params: unknown[] = [org(req)];
    if (integration_id) { params.push(integration_id); query += ` AND al.integration_id=$${params.length}`; }
    if (level) { params.push(level); query += ` AND al.level=$${params.length}`; }
    query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await db(req)(query, params);
    res.json({ logs: r.rows, count: r.rows.length });
  } catch { res.json({ logs: [], count: 0 }); }
});

// ── GET /api/integrations/runs ─────────────────────────────────────────────────
router.get("/integrations/runs", requireAdmin, async (req, res) => {
  const { integration_id, status, limit: lim = "50" } = req.query as Record<string, string>;
  try {
    let query = `SELECT ar.*, ai.name as integration_name, ai.platform
                 FROM automation_runs ar
                 LEFT JOIN automation_integrations ai ON ai.id = ar.integration_id
                 WHERE ar.org_id=$1`;
    const params: unknown[] = [org(req)];
    if (integration_id) { params.push(integration_id); query += ` AND ar.integration_id=$${params.length}`; }
    if (status) { params.push(status); query += ` AND ar.status=$${params.length}`; }
    query += ` ORDER BY ar.triggered_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await db(req)(query, params);
    res.json({ runs: r.rows, count: r.rows.length });
  } catch { res.json({ runs: [], count: 0 }); }
});

// ── GET /api/integrations/incoming-webhooks ────────────────────────────────────
router.get("/integrations/incoming-webhooks", requireAdmin, async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT * FROM incoming_webhooks WHERE org_id=$1 ORDER BY created_at DESC`,
      [org(req)]
    );
    res.json({ webhooks: r.rows, count: r.rows.length });
  } catch { res.json({ webhooks: [], count: 0 }); }
});

// ── GET /api/integrations/zapier ───────────────────────────────────────────────
router.get("/integrations/zapier", requireAdmin, async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT * FROM automation_integrations WHERE org_id=$1 AND platform='zapier' ORDER BY created_at DESC`,
      [org(req)]
    );
    let stats = { runs: 0, success: 0 };
    if (r.rows.length > 0) {
      const ids = r.rows.map((i) => (i as Record<string, unknown>).id);
      const sr = await db(req)(
        `SELECT COUNT(*) runs, COUNT(*) FILTER(WHERE status='success') success FROM automation_runs WHERE org_id=$1 AND integration_id=ANY($2)`,
        [org(req), ids]
      );
      stats = sr.rows[0] as typeof stats ?? stats;
    }
    res.json({ integrations: r.rows, stats, zapierAppUrl: "https://zapier.com/apps/flowpoint", webhookUrl: `/api/integrations/webhook/incoming` });
  } catch (err) { logger.error({ err }, "[integrations/zapier] failed"); res.json({ integrations: [], stats: { runs: 0, success: 0 } }); }
});

// ── POST /api/integrations/zapier/connect ──────────────────────────────────────
router.post("/integrations/zapier/connect", requireAdmin, async (req, res) => {
  const { webhookUrl, events = [], name = "Zapier Integration" } = req.body as { webhookUrl?: string; events?: string[]; name?: string };
  if (!webhookUrl) { res.status(400).json({ error: "webhookUrl requis" }); return; }
  try {
    const intg = await createIntegration(org(req), plan(req), {
      name, type: "outgoing", platform: "zapier", endpointUrl: webhookUrl, events,
      metadata: { platform: "zapier", connected_at: new Date().toISOString() },
    });
    res.status(201).json({ ok: true, integration: intg });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("Limite") ? 429 : 500).json({ error: msg });
  }
});

// ── GET /api/integrations/make ─────────────────────────────────────────────────
router.get("/integrations/make", requireAdmin, async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT * FROM automation_integrations WHERE org_id=$1 AND platform='make' ORDER BY created_at DESC`,
      [org(req)]
    );
    res.json({ integrations: r.rows, makeAppUrl: "https://www.make.com/en/integrations/flowpoint", webhookUrl: `/api/integrations/webhook/incoming` });
  } catch { res.json({ integrations: [] }); }
});

// ── POST /api/integrations/make/connect ───────────────────────────────────────
router.post("/integrations/make/connect", requireAdmin, async (req, res) => {
  const { webhookUrl, events = [], name = "Make Integration", scenarioName } = req.body as {
    webhookUrl?: string; events?: string[]; name?: string; scenarioName?: string;
  };
  if (!webhookUrl) { res.status(400).json({ error: "webhookUrl requis" }); return; }
  try {
    const intg = await createIntegration(org(req), plan(req), {
      name, type: "outgoing", platform: "make", endpointUrl: webhookUrl, events,
      metadata: { platform: "make", scenario_name: scenarioName, connected_at: new Date().toISOString() },
    });
    res.status(201).json({ ok: true, integration: intg });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("Limite") ? 429 : 500).json({ error: msg });
  }
});

// ── POST /api/integrations/connections ─────────────────────────────────────────
router.post("/integrations/connections", requireAdmin, async (req, res) => {
  const { name, platform, endpointUrl, events = [], headers = {}, retryEnabled = true, maxRetries = 3 } = req.body as {
    name?: string; platform?: string; endpointUrl?: string;
    events?: string[]; headers?: Record<string, string>;
    retryEnabled?: boolean; maxRetries?: number;
  };
  if (!name || !platform) { res.status(400).json({ error: "name et platform requis" }); return; }
  try {
    const intg = await createIntegration(org(req), plan(req), {
      name, type: "outgoing", platform, endpointUrl, events, headers, retryEnabled, maxRetries,
    });
    res.status(201).json({ ok: true, integration: intg });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("Limite") ? 429 : 500).json({ error: msg });
  }
});

// ── PATCH /api/integrations/connections/:id ────────────────────────────────────
router.patch("/integrations/connections/:id", requireAdmin, async (req, res) => {
  const { active, name, events, endpointUrl, headers } = req.body as {
    active?: boolean; name?: string; events?: string[];
    endpointUrl?: string; headers?: Record<string, string>;
  };
  const updates: string[] = ["updated_at=now()"];
  const params: unknown[] = [];
  if (active !== undefined) { params.push(active);                    updates.push(`active=$${params.length}`); }
  if (name)        { params.push(name);                    updates.push(`name=$${params.length}`); }
  if (events)      { params.push(JSON.stringify(events));  updates.push(`events=$${params.length}`); }
  if (endpointUrl) { params.push(endpointUrl);             updates.push(`endpoint_url=$${params.length}`); }
  if (headers)     { params.push(JSON.stringify(headers)); updates.push(`headers=$${params.length}`); }
  params.push(req.params.id, org(req));
  try {
    const r = await db(req)(
      `UPDATE automation_integrations SET ${updates.join(",")} WHERE id=$${params.length - 1} AND org_id=$${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) { res.status(404).json({ error: "not found" }); return; }
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Update failed" }); }
});

// ── DELETE /api/integrations/connections/:id ───────────────────────────────────
router.delete("/integrations/connections/:id", requireAdmin, async (req, res) => {
  try {
    await db(req)(
      `UPDATE automation_integrations SET active=false, updated_at=now() WHERE id=$1 AND org_id=$2`,
      [req.params.id, org(req)]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Delete failed" }); }
});

// ── POST /api/integrations/connections/:id/test ────────────────────────────────
router.post("/integrations/connections/:id/test", requireAdmin, async (req, res) => {
  try {
    const result = await testIntegration(req.params.id, org(req));
    res.json(result);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// ── POST /api/integrations/test ────────────────────────────────────────────────
router.post("/integrations/test", requireAdmin, async (req, res) => {
  const { integration_id } = req.body as { integration_id?: string };
  if (!integration_id) { res.status(400).json({ error: "integration_id requis" }); return; }
  try {
    const result = await testIntegration(integration_id, org(req));
    res.json(result);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// ── POST /api/integrations/dispatch ────────────────────────────────────────────
router.post("/integrations/dispatch", requireAdmin, async (req, res) => {
  const { event, payload = {} } = req.body as { event?: string; payload?: Record<string, unknown> };
  if (!event || !SUPPORTED_EVENTS.includes(event as typeof SUPPORTED_EVENTS[number])) {
    res.status(400).json({ error: "event invalide", supported: SUPPORTED_EVENTS }); return;
  }
  try {
    const result = await dispatchEvent(event as typeof SUPPORTED_EVENTS[number], payload, org(req));
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// ── POST /api/integrations/webhooks ─ save outgoing webhook ──────────────────
router.post("/integrations/webhooks", requireAdmin, async (req, res) => {
  const { url, events = ["*"], headers = {} } = req.body as { url?: string; events?: string[]; headers?: Record<string, string> };
  if (!url) { res.status(400).json({ error: "url requis" }); return; }
  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db(req)(
      `INSERT INTO automation_integrations (id, org_id, name, type, platform, endpoint_url, events, headers, active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,now(),now()) RETURNING *`,
      [id, org(req), url, "outgoing", "webhook", url, JSON.stringify(events), JSON.stringify(headers)]
    );
    res.status(201).json({ ok: true, id, url });
  } catch { res.status(500).json({ error: "Failed to save webhook" }); }
});

// ── POST /api/integrations/webhooks/test ─ ping test ─────────────────────────
router.post("/integrations/webhooks/test", requireAdmin, async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url requis" }); return; }
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 8_000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "FlowPoint-Webhook-Test/1.0" },
      body: JSON.stringify({ event: "ping", ts: Date.now(), source: "flowpoint-test" }),
      signal: ac.signal,
    });
    clearTimeout(to);
    res.json({ ok: r.ok, url, statusCode: r.status, durationMs: 0, note: r.ok ? "Ping OK" : "Endpoint a renvoyé une erreur" });
  } catch (err) {
    res.json({ ok: false, url, error: safeErrMsg(err), note: "Test indisponible — enregistrez le webhook" });
  }
});

// ── POST /api/integrations/webhook/incoming/:token — public ────────────────────
router.post("/integrations/webhook/incoming/:token", async (req, res) => {
  try {
    const result = await processIncomingWebhook(req.params.token, req.body || {}, org(req));
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("invalide") ? 401 : 500).json({ error: msg });
  }
});

// ── POST /api/integrations/webhook/incoming (header token) ─────────────────────
router.post("/integrations/webhook/incoming", async (req, res) => {
  const token = req.headers["x-flowpoint-token"] as string || req.query.token as string;
  if (!token) { res.status(400).json({ error: "token requis (header X-FlowPoint-Token ou ?token=)" }); return; }
  try {
    const result = await processIncomingWebhook(token, req.body || {}, org(req));
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("invalide") ? 401 : 500).json({ error: msg });
  }
});

// ── POST /api/integrations/incoming-webhooks ────────────────────────────────────
router.post("/integrations/incoming-webhooks", requireAdmin, async (req, res) => {
  const { name, source = "custom", action = "create_mission", action_config = {} } = req.body as {
    name?: string; source?: string; action?: string; action_config?: Record<string, unknown>;
  };
  if (!name) { res.status(400).json({ error: "name requis" }); return; }
  const token = crypto.randomBytes(24).toString("hex");
  const id = `iw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const r = await db(req)(
      `INSERT INTO incoming_webhooks (id, org_id, name, token, source, action, action_config, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,
      [id, org(req), name, token, source, action, JSON.stringify(action_config)]
    );
    res.status(201).json({ ok: true, webhook: r.rows[0], url: `/api/integrations/webhook/incoming/${token}` });
  } catch { res.status(500).json({ error: "Failed to create incoming webhook" }); }
});

// ── DELETE /api/integrations/incoming-webhooks/:id ─────────────────────────────
router.delete("/integrations/incoming-webhooks/:id", requireAdmin, async (req, res) => {
  try {
    await db(req)(
      `UPDATE incoming_webhooks SET active=false WHERE id=$1 AND org_id=$2`,
      [req.params.id, org(req)]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to delete webhook" }); }
});

// ── POST /api/integrations/runs/:id/retry ──────────────────────────────────────
router.post("/integrations/runs/:id/retry", requireAdmin, async (req, res) => {
  try {
    const runRes = await db(req)(
      `SELECT ar.*, ai.endpoint_url, ai.secret_key, ai.headers, ai.timeout_ms, ai.max_retries, ai.retry_enabled
       FROM automation_runs ar JOIN automation_integrations ai ON ai.id = ar.integration_id
       WHERE ar.id=$1 AND ar.org_id=$2 AND ar.status='failed'`,
      [req.params.id, org(req)]
    );
    if (!runRes.rows.length) { res.status(404).json({ error: "run non trouvé ou pas en échec" }); return; }
    const run = runRes.rows[0] as Record<string, unknown>;
    await db(req)(`UPDATE automation_runs SET status='retrying', attempt=attempt+1 WHERE id=$1`, [run.id]);
    res.json({ ok: true, message: "Nouvelle tentative planifiée" });
    void dispatchEvent(run.event_type as typeof SUPPORTED_EVENTS[number], (run.payload as Record<string, unknown>) || {}, org(req));
  } catch { res.status(500).json({ error: "Retry failed" }); }
});

export default router;
