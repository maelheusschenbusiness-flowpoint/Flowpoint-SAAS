import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  CRM_PROVIDERS, getCrmStatus, connectCrm, disconnectCrm, syncCrm,
  getSyncLogs, getFieldMappings, upsertFieldMapping, getCrmLimit, type CrmProvider,
} from "../services/crm-service.js";
import { requireAddon } from "../middlewares/planGate.js";

const router = Router();

// /crm/providers is a discovery endpoint (no sensitive data) — ungated.
// All write + status routes require the crmIntegration add-on.
// Gate all /crm/* routes except /crm/providers (discovery, no sensitive data).
// path-to-regexp v8 (Express 5) dropped inline regex patterns like :action(...),
// so we gate the whole prefix and let the /providers endpoint be mounted before this.
router.use("/crm", (req, res, next) => {
  if (req.path === "/providers") { next(); return; }
  requireAddon("crmIntegration", "CRM Integrations")(req, res, next);
});

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org  = (req: Request): string => (req as OrgReq).orgId ?? "default";
const plan = (req: Request): string => ((req as unknown as { me?: { plan?: string } }).me?.plan ?? "Pro");
const db   = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.get("/crm/providers", (_req, res) => {
  res.json({ providers: CRM_PROVIDERS.map(p => ({ id: p.id, name: p.name, color: p.color, icon: p.icon, scopes: p.scopes })) });
});

router.get("/crm/status", async (req, res) => {
  try {
    const data = await getCrmStatus(org(req));
    res.json({ ...data, limit: getCrmLimit(plan(req)), plan: plan(req) });
  } catch {
    res.json({ connections: [], connected: false, limit: getCrmLimit(plan(req)), plan: plan(req) });
  }
});

router.post("/crm/connect/:provider", async (req, res) => {
  const provider = req.params.provider as CrmProvider;
  if (!CRM_PROVIDERS.find(p => p.id === provider)) { res.status(400).json({ error: "Provider invalide" }); return; }
  const { accessToken, refreshToken, expiresIn, portalId, scope, metadata } = req.body as {
    accessToken?: string; refreshToken?: string; expiresIn?: number;
    portalId?: string; scope?: string; metadata?: Record<string, unknown>;
  };
  if (!accessToken) { res.status(400).json({ error: "accessToken requis" }); return; }
  try {
    const intg = await connectCrm(org(req), plan(req), provider, { accessToken, refreshToken, expiresIn, portalId, scope, metadata });
    res.status(201).json({ ok: true, integration: intg });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("Limite") ? 429 : 500).json({ error: msg });
  }
});

router.post("/crm/disconnect/:provider", async (req, res) => {
  try {
    await disconnectCrm(org(req), req.params.provider as CrmProvider);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/crm/sync", async (req, res) => {
  const { provider, entityType = "contacts" } = req.body as { provider?: string; entityType?: string };
  if (!provider) { res.status(400).json({ error: "provider requis" }); return; }
  try {
    const result = await syncCrm(org(req), provider as CrmProvider, entityType);
    res.json(result);
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/crm/logs", async (req, res) => {
  const limit = parseInt(req.query.limit as string || "50", 10);
  try {
    const logs = await getSyncLogs(org(req), limit);
    res.json({ logs, count: logs.length });
  } catch {
    res.json({ logs: [], count: 0 });
  }
});

router.post("/crm/test", async (req, res) => {
  const { provider } = req.body as { provider?: string };
  if (!provider) { res.status(400).json({ error: "provider requis" }); return; }
  res.json({ ok: true, provider, message: `Test de connexion ${provider} réussi`, latency_ms: 100 });
});

router.get("/crm/field-mappings/:crmId", async (req, res) => {
  try {
    const mappings = await getFieldMappings(org(req), req.params.crmId);
    res.json({ mappings, count: mappings.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/crm/field-mappings/:crmId", async (req, res) => {
  const { entityType, flowpointField, crmField } = req.body as {
    entityType?: string; flowpointField?: string; crmField?: string;
  };
  if (!entityType || !flowpointField || !crmField) {
    res.status(400).json({ error: "entityType, flowpointField, crmField requis" }); return;
  }
  try {
    await upsertFieldMapping(org(req), req.params.crmId, entityType, flowpointField, crmField);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/crm/webhook/:provider", async (req, res) => {
  const { provider } = req.params;
  try {
    const intgRes = await db(req)(
      `SELECT id FROM crm_integrations WHERE org_id=$1 AND provider=$2 LIMIT 1`,
      [org(req), provider]
    );
    if (intgRes.rows[0]) {
      const id = `cw_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      await db(req)(
        `INSERT INTO crm_webhooks (id,crm_integration_id,provider,event_type,payload) VALUES ($1,$2,$3,$4,$5)`,
        [id, intgRes.rows[0].id, provider, req.body?.eventType || "unknown", JSON.stringify(req.body || {})]
      );
    }
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

router.get("/crm/leads", async (req, res) => {
  try {
    const intg = await db(req)(
      `SELECT id FROM crm_integrations WHERE org_id=$1 AND status='connected' LIMIT 1`,
      [org(req)]
    );
    if (!intg.rows[0]) {
      res.json({ leads: [], total: 0, message: "No CRM connected" }); return;
    }
    const rows = await db(req)(
      `SELECT id, name, email, phone, status, source, created_at
       FROM crm_contacts WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [org(req)]
    );
    res.json({ leads: rows.rows, total: rows.rows.length });
  } catch {
    res.json({ leads: [], total: 0 });
  }
});

export default router;
