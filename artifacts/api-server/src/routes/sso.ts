import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
const errStatus = (err: unknown): number => (err && typeof err === "object" && typeof (err as { statusCode?: unknown }).statusCode === "number") ? (err as { statusCode: number }).statusCode : 500;
const errMsg = (err: unknown): string => errStatus(err) === 500 ? safeErrMsg(err) : (err instanceof Error ? err.message : String(err));
import { requireAdmin } from "../middlewares/requireAdmin.js";
import {
  SSO_PROVIDER_TYPES, SSO_PROVIDER_CATALOG, getSSODashboard,
  updateSSOProvider, deleteSSOProvider, getOrgAuthConfig,
  logLoginAttempt, invalidateSession, getLoginAudits,
} from "../services/sso-service.js";

// ── publicSsoRouter — no auth required ────────────────────────────────────────
// SAML ACS/init/metadata/capabilities are called by external IdPs or disclosed
// publicly. Must be registered BEFORE requireAuth in routes/index.ts.
export const publicSsoRouter = Router();

// GET /sso/capabilities — public disclosure of available vs roadmap providers
publicSsoRouter.get("/sso/capabilities", (_req, res) => {
  res.json({
    available: [],
    roadmap: SSO_PROVIDER_CATALOG.map(({ id, protocol }) => ({
      provider: id,
      protocol,
      status: "not_implemented",
      note: "Aucun flux de connexion SSO n’est actuellement disponible.",
    })),
  });
});

// Do not publish metadata for an ACS that cannot process SAML assertions.
publicSsoRouter.get("/sso/saml/metadata", (_req, res) => {
  res.status(501).json({
    error: "SSO_NOT_IMPLEMENTED",
    message: "Les métadonnées SAML seront disponibles avec le flux ACS opérationnel.",
  });
});

// SAML ACS — not implemented.
publicSsoRouter.post("/sso/saml/:orgId/acs", (_req, res) => {
  res.status(501).json({
    error: "SSO_NOT_IMPLEMENTED",
    message: "Le service SAML ACS n’est pas encore implémenté.",
  });
});

// SAML SP-initiated login — not implemented.
publicSsoRouter.get("/sso/saml/:orgId/init", (_req, res) => {
  res.status(501).json({
    error: "SSO_NOT_IMPLEMENTED",
    message: "La connexion SAML initiée par le fournisseur de service n’est pas implémentée.",
  });
});

// ── Protected SSO router (auth required) ──────────────────────────────────────
const router = Router();
const org  = (req: import("express").Request) => req.orgId ?? "default";
// Resolve plan from org DB (org-isolated); never falls back to a foreign org's data
async function getPlan(req: import("express").Request): Promise<string> {
  try {
    const { loadOrgSettings } = await import("../services/org-settings.js");
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const settings = await loadOrgSettings(orgId);
    if (settings?.plan) return settings.plan.charAt(0).toUpperCase() + settings.plan.slice(1).toLowerCase();
  } catch { /* fallback */ }
  return "Standard";
}

router.get("/sso", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    res.json({ ...data, providers_catalog: SSO_PROVIDER_CATALOG, plan: await getPlan(req) });
  } catch {
    res.json({ providers: [], auth_config: null, login_audits: [], providers_catalog: SSO_PROVIDER_CATALOG, plan: await getPlan(req) });
  }
});

router.get("/sso/providers-catalog", (_req, res) => {
  res.json({
    available: [],
    providers: SSO_PROVIDER_CATALOG.map(provider => ({
      ...provider,
      status: "not_implemented",
    })),
  });
});

router.get("/sso/providers", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    res.json({ providers: (data as { providers: unknown[] }).providers });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.post("/sso/providers", requireAdmin, async (req, res) => {
  const { providerType, name } = req.body as { providerType?: string; name?: string };
  if (!providerType || !name) { res.status(400).json({ error: "providerType et name requis" }); return; }
  if (!SSO_PROVIDER_TYPES.includes(providerType as typeof SSO_PROVIDER_TYPES[number])) {
    res.status(400).json({ error: "SSO_PROVIDER_UNSUPPORTED" });
    return;
  }
  res.status(501).json({
    error: "SSO_NOT_IMPLEMENTED",
    message: "Aucun fournisseur SSO ne peut encore créer une configuration de connexion.",
  });
});

router.patch("/sso/providers/:id", requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as { enabled?: unknown; enforce_sso?: unknown; auto_provision?: unknown };
  if (body.enabled === true) {
    res.status(501).json({
      error: "SSO_NOT_IMPLEMENTED",
      message: "Un fournisseur SSO ne peut pas être activé avant la disponibilité du flux de connexion.",
    });
    return;
  }
  // C-11 : ces options étaient enregistrées sans être appliquées nulle part ;
  // les accepter laissait croire à une protection (SSO obligatoire, création
  // automatique des comptes) qui n'existe pas encore.
  if (body.enforce_sso === true || body.auto_provision === true) {
    res.status(501).json({
      error: "SSO_NOT_IMPLEMENTED",
      message: "L'obligation de SSO et le provisionnement automatique ne sont pas appliqués : ils ne peuvent pas être activés avant la disponibilité du flux de connexion.",
    });
    return;
  }
  try {
    await updateSSOProvider(org(req), req.params["id"] as string, req.body as Partial<{ enabled: boolean; enforce_sso: boolean; domain: string; auto_provision: boolean }>);
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.delete("/sso/providers/:id", requireAdmin, async (req, res) => {
  try {
    await deleteSSOProvider(org(req), req.params["id"] as string);
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.get("/sso/auth-config", requireAdmin, async (req, res) => {
  try {
    const config = await getOrgAuthConfig(org(req));
    res.json({ config, applied: false, status: "not_implemented" });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.put("/sso/auth-config", requireAdmin, async (req, res) => {
  res.status(501).json({
    error: "SSO_NOT_IMPLEMENTED",
    message: "La configuration de politiques SSO ne peut pas être enregistrée avant le flux de connexion.",
  });
});

router.get("/sso/login-audits", requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit as string || "50", 10);
  try {
    const logs = await getLoginAudits(org(req), limit);
    res.json({ logs, count: logs.length });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.post("/sso/login-audit", requireAdmin, async (req, res) => {
  const { email, provider = 'email', success = true, userId, ipAddress, failureReason } = req.body as {
    email?: string; provider?: string; success?: boolean;
    userId?: string; ipAddress?: string; failureReason?: string;
  };
  if (!email) { res.status(400).json({ error: "email requis" }); return; }
  try {
    await logLoginAttempt(org(req), { userId, email, provider, success, ipAddress, userAgent: req.headers['user-agent'], failureReason });
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.get("/sso/sessions", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    res.json({ sessions: (data as unknown as { active_sessions: unknown[] }).active_sessions });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.post("/sso/sessions/:id/invalidate", requireAdmin, async (req, res) => {
  try {
    await invalidateSession(org(req), req.params["id"] as string);
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

// NOTE: SAML ACS, init, metadata, capabilities are on publicSsoRouter (no auth needed).
// See publicSsoRouter export above — registered BEFORE requireAuth in routes/index.ts.

// C-11 : état explicite. Aucune politique SSO n'est appliquée à la connexion
// tant que le flux SSO n'existe pas ; on ne renvoie donc jamais `enforceSSO: true`.
const NON_APPLIQUEE = {
  enforceSSO: false,
  applied: false,
  status: "not_implemented",
  message: "Les politiques SSO enregistrées ne sont pas appliquées à la connexion.",
} as const;

// ── GET /sso/policies ─────────────────────────────────────────────────────────
router.get("/sso/policies", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    const stockees = ((data as { policies?: Record<string, unknown> }).policies ?? {
      requireMFA: false, allowLocalLogin: true, sessionTimeout: 480,
      ipWhitelist: "",
    });
    res.json({ ...stockees, ...NON_APPLIQUEE });
  } catch { res.json({ requireMFA: false, allowLocalLogin: true, sessionTimeout: 480, ipWhitelist: "", ...NON_APPLIQUEE }); }
});

router.patch("/sso/policies", requireAdmin, async (req, res) => {
  res.status(501).json({
    error: "SSO_NOT_IMPLEMENTED",
    message: "Les politiques SSO ne sont pas modifiables tant qu’aucun fournisseur n’est opérationnel.",
  });
});

export default router;
