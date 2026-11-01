import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  CRM_PROVIDERS, getCrmStatus, disconnectCrm, syncCrm,
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
    res.status(503).json({
      error: "Impossible de charger l’état des intégrations CRM.",
      code: "CRM_STATUS_UNAVAILABLE",
    });
  }
});

router.post("/crm/connect/:provider", async (req, res) => {
  const provider = req.params.provider as CrmProvider;
  if (!CRM_PROVIDERS.find(p => p.id === provider)) { res.status(400).json({ error: "Provider invalide" }); return; }
  res.status(501).json({
    ok: false,
    code: "CRM_OAUTH_UNAVAILABLE",
    error: "La connexion OAuth CRM n’est pas encore disponible. Aucun jeton n’a été enregistré.",
  });
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
  if (!CRM_PROVIDERS.some((item) => item.id === provider)) { res.status(400).json({ error: "Provider invalide" }); return; }
  try {
    const result = await syncCrm(org(req), provider as CrmProvider, entityType);
    res.json(result);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "CRM_SYNC_UNAVAILABLE") {
      res.status(501).json({ ok: false, code, error: safeErrMsg(err) });
      return;
    }
    res.status(500).json({ error: safeErrMsg(err) });
  }
});

router.get("/crm/logs", async (req, res) => {
  const limit = parseInt(req.query.limit as string || "50", 10);
  try {
    const logs = await getSyncLogs(org(req), limit);
    res.json({ logs, count: logs.length });
  } catch {
    res.status(503).json({ error: "Impossible de charger l’historique CRM.", code: "CRM_LOGS_UNAVAILABLE" });
  }
});

router.post("/crm/test", async (req, res) => {
  const { provider } = req.body as { provider?: string };
  if (!provider) { res.status(400).json({ error: "provider requis" }); return; }
  if (!CRM_PROVIDERS.some((item) => item.id === provider)) { res.status(400).json({ error: "Provider invalide" }); return; }
  res.status(501).json({
    ok: false,
    provider,
    code: "CRM_TEST_UNAVAILABLE",
    error: "Le test réel de connexion à ce fournisseur n’est pas encore implémenté.",
  });
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
  res.status(501).json({
    ok: false,
    code: "CRM_WEBHOOK_UNAVAILABLE",
    error: "Les webhooks CRM ne sont pas configurés.",
  });
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
    res.status(503).json({ error: "Impossible de charger les leads CRM.", code: "CRM_LEADS_UNAVAILABLE" });
  }
});

export default router;
