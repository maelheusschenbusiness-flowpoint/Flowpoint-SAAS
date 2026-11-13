import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  CRM_PROVIDERS, getCrmStatus, disconnectCrm,
  getSyncLogs, getFieldMappings, upsertFieldMapping, getCrmLimit, type CrmProvider,
} from "../services/crm-service.js";
import { requireAddon, resolvePlanFromDB } from "../middlewares/planGate.js";
import { logger } from "../lib/logger.js";
import { getCrmAdapter, implementedCrmProviders } from "../services/crm/registry.js";
import {
  CrmError, completeCrmOAuth, getValidCrmToken, consumeCrmState, crmRedirectUri, processCrmWebhook, startCrmOAuth, syncCrmContacts,
} from "../services/crm/crm-core.js";

const router = Router();
/** Routes publiques : redirection OAuth du fournisseur et webhooks signes (aucune session). */
export const crmPublicRouter = Router();

const frontendUrl = (): string => (process.env["FRONTEND_URL"] ?? "https://app.flowpoint.pro").replace(/\/+$/, "");

crmPublicRouter.get("/crm/oauth/:provider/callback", async (req, res) => {
  const provider = String(req.params["provider"] ?? "");
  const adapter = getCrmAdapter(provider);
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (!adapter) { res.status(404).json({ ok: false, code: "CRM_PROVIDER_UNSUPPORTED" }); return; }
  // L'etat est consomme meme si le fournisseur renvoie une erreur : un etat ne sert qu'une fois.
  const orgId = typeof state === "string" ? await consumeCrmState(state, provider).catch(() => null) : null;
  if (!orgId) { res.status(400).json({ ok: false, code: "CRM_STATE_INVALID", error: "Invalid or expired OAuth state" }); return; }
  if (error) { res.redirect(`${frontendUrl()}/dashboard?crm_error=consent_denied&crm_provider=${provider}`); return; }
  if (typeof code !== "string" || !code || code.length > 2048) {
    res.status(400).json({ ok: false, code: "CRM_CODE_INVALID" }); return;
  }
  try {
    const orgPlan = (await resolvePlanFromDB({ orgId } as unknown as Request)) ?? "standard";
    await completeCrmOAuth(adapter, orgId, orgPlan, code);
    res.redirect(`${frontendUrl()}/dashboard?crm_connected=${provider}`);
  } catch (cause) {
    const failure = cause instanceof CrmError ? cause.code : "oauth_failed";
    logger.warn({ event: "crm_oauth_callback_failed", provider, code: failure }, "[crm] OAuth callback failed");
    res.redirect(`${frontendUrl()}/dashboard?crm_error=${encodeURIComponent(failure)}&crm_provider=${provider}`);
  }
});

crmPublicRouter.post("/crm/webhook/:provider", async (req, res) => {
  const provider = String(req.params["provider"] ?? "");
  const adapter = getCrmAdapter(provider);
  if (!adapter) { res.status(404).json({ ok: false, code: "CRM_PROVIDER_UNSUPPORTED" }); return; }
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!Buffer.isBuffer(rawBody) || !adapter.isConfigured()) {
    res.status(401).json({ ok: false, code: "CRM_WEBHOOK_UNAUTHORIZED" }); return;
  }
  const base = (process.env["CRM_WEBHOOK_PUBLIC_URL"] ?? crmRedirectUri(provider).replace(/\/api\/crm\/oauth\/.*$/, "")).replace(/\/+$/, "");
  const valid = adapter.verifyWebhook({
    rawBody, method: "POST", url: `${base}/api/crm/webhook/${provider}`, headers: req.headers,
  });
  if (!valid) {
    logger.warn({ event: "crm_webhook_rejected", provider }, "[crm] webhook signature rejected");
    res.status(401).json({ ok: false, code: "CRM_WEBHOOK_UNAUTHORIZED" }); return;
  }
  try {
    const result = await processCrmWebhook(adapter, adapter.parseWebhook(rawBody));
    res.json({ ok: true, ...result });
  } catch {
    res.status(503).json({ ok: false, code: "CRM_WEBHOOK_UNAVAILABLE" });
  }
});

function crmFailure(res: import("express").Response, err: unknown): void {
  if (err instanceof CrmError) { res.status(err.httpStatus).json({ ok: false, code: err.code, error: err.message }); return; }
  const code = (err as { code?: string } | null)?.code;
  if (typeof code === "string" && code.startsWith("CRM_")) { res.status(502).json({ ok: false, code, error: "Le fournisseur CRM a refuse la requete." }); return; }
  res.status(500).json({ ok: false, code: "CRM_INTERNAL_ERROR", error: safeErrMsg(err) });
}

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
/**
 * Plan de l'organisation LU EN BASE (resolvePlanFromDB, meme source que planGate/keywords.ts).
 * Avant : repli sur Pro via `req.me` -- `req.me` n'est renseigne par aucun middleware, donc TOUTE
 * organisation (Standard comprise) etait traitee comme Pro. Plan illisible => "standard" (le moins permissif).
 */
const plan = async (req: Request): Promise<string> => (await resolvePlanFromDB(req)) ?? "standard";
const db   = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.get("/crm/providers", (_req, res) => {
  const implemented = implementedCrmProviders();
  res.json({ providers: CRM_PROVIDERS.map(p => {
    const adapter = getCrmAdapter(p.id);
    return {
      id: p.id, name: p.name, color: p.color, icon: p.icon, scopes: adapter?.scopes ?? p.scopes,
      available: implemented.includes(p.id) && Boolean(adapter?.isConfigured()),
      implemented: implemented.includes(p.id),
    };
  }) });
});

router.get("/crm/status", async (req, res) => {
  try {
    const data = await getCrmStatus(org(req));
    const orgPlan = await plan(req);
    res.json({ ...data, limit: getCrmLimit(orgPlan), plan: orgPlan });
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
  const adapter = getCrmAdapter(provider);
  if (!adapter) {
    res.status(501).json({
      ok: false,
      code: "CRM_OAUTH_UNAVAILABLE",
      error: "La connexion OAuth de ce CRM n’est pas encore disponible. Aucun jeton n’a été enregistré.",
    });
    return;
  }
  try {
    const { url } = await startCrmOAuth(org(req), await plan(req), adapter);
    res.json({ ok: true, url });
  } catch (err) { crmFailure(res, err); }
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
  const adapter = getCrmAdapter(provider);
  if (!adapter) {
    res.status(501).json({ ok: false, code: "CRM_SYNC_UNAVAILABLE", error: "La synchronisation de ce CRM n’est pas encore implémentée." });
    return;
  }
  if (entityType !== "contacts") { res.status(400).json({ ok: false, code: "CRM_ENTITY_UNSUPPORTED", error: "Seuls les contacts sont synchronisés." }); return; }
  try {
    res.json(await syncCrmContacts(adapter, org(req)));
  } catch (err) { crmFailure(res, err); }
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
  const adapter = getCrmAdapter(provider);
  if (!adapter) {
    res.status(501).json({
      ok: false, provider, code: "CRM_TEST_UNAVAILABLE",
      error: "Le test réel de connexion à ce fournisseur n’est pas encore implémenté.",
    });
    return;
  }
  try {
    const { accessToken } = await getValidCrmToken(adapter, org(req));
    await adapter.fetchContacts(accessToken, null, 1);
    res.json({ ok: true, provider });
  } catch (err) { crmFailure(res, err); }
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
