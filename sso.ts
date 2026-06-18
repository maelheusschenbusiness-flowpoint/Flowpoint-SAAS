import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import {
  SSO_PROVIDER_TYPES, getSSODashboard, createSSOProvider,
  updateSSOProvider, deleteSSOProvider, getOrgAuthConfig,
  upsertOrgAuthConfig, logLoginAttempt, invalidateSession, getLoginAudits,
} from "../services/sso-service.js";

// ── publicSsoRouter — no auth required ────────────────────────────────────────
// SAML ACS/init/metadata/capabilities are called by external IdPs or disclosed
// publicly. Must be registered BEFORE requireAuth in routes/index.ts.
export const publicSsoRouter = Router();

// GET /sso/capabilities — public disclosure of available vs roadmap providers
publicSsoRouter.get("/sso/capabilities", (_req, res) => {
  res.json({
    available: [
      { provider: "google_workspace", status: "available", note: "OAuth 2.0 Google — production ready" },
      { provider: "github", status: "available", note: "OAuth 2.0 GitHub — production ready" },
    ],
    roadmap: [
      { provider: "saml", status: "not_implemented", eta: "Q3 2026", note: "SAML 2.0 générique — Enterprise roadmap" },
      { provider: "okta", status: "not_implemented", eta: "Q3 2026", note: "Okta SAML/OIDC — Enterprise roadmap" },
      { provider: "azure_ad", status: "not_implemented", eta: "Q3 2026", note: "Azure AD — Enterprise roadmap" },
      { provider: "onelogin", status: "not_implemented", eta: "Q3 2026", note: "OneLogin — Enterprise roadmap" },
    ],
  });
});

// SAML Metadata endpoint (public — IdPs fetch it during setup)
publicSsoRouter.get("/sso/saml/metadata", (req, res) => {
  const orgId = (req as any).orgId ?? "default";
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : 'https://app.flowpoint.io';
  res.set('Content-Type', 'application/xml');
  // NOTE: ACS endpoint listed here is NOT yet active (returns 501).
  res.send(`<?xml version="1.0"?>
<EntityDescriptor entityID="${baseUrl}/api/sso/saml/${orgId}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${baseUrl}/api/sso/saml/${orgId}/acs" index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`);
});

// SAML ACS — NOT IMPLEMENTED (roadmap Q3 2026)
publicSsoRouter.post("/sso/saml/:orgId/acs", (_req, res) => {
  res.status(501).json({
    error: "Not Implemented",
    message: "SAML ACS (Assertion Consumer Service) n'est pas encore implémenté. Roadmap Enterprise Q3 2026.",
    roadmap: "SAML 2.0 complet — Enterprise Q3 2026",
  });
});

// SAML SP-initiated login — NOT IMPLEMENTED (roadmap Q3 2026)
publicSsoRouter.get("/sso/saml/:orgId/init", (_req, res) => {
  res.status(501).json({
    error: "Not Implemented",
    message: "SAML SP-initiated login n'est pas encore implémenté.",
    roadmap: "SAML 2.0 complet — Enterprise Q3 2026",
  });
});

// ── Protected SSO router (auth required) ──────────────────────────────────────
const router = Router();
const org  = (req: import("express").Request) => req.orgId ?? "default";
const plan = (req: import("express").Request) => ((req as unknown as { me?: { plan?: string } }).me?.plan ?? "Pro");

// ── SAML provider types that are NOT yet production-ready ─────────────────────
// TODO: Implement full SAML 2.0 flow (AuthnRequest, ACS, SAMLResponse parsing)
//       using a SAML library (node-saml or samlify). Until then, these return 501.
const SAML_ROADMAP_PROVIDERS = new Set(['saml', 'okta', 'azure_ad', 'onelogin', 'saml_generic']);

router.get("/sso", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    res.json({ ...data, providers_catalog: SSO_PROVIDER_TYPES, plan: plan(req) });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/sso/providers-catalog", (_req, res) => {
  res.json({ providers: SSO_PROVIDER_TYPES });
});

router.get("/sso/providers", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    res.json({ providers: (data as { providers: unknown[] }).providers });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/sso/providers", requireAdmin, async (req, res) => {
  const { providerType, name, domain, clientId, clientSecret, metadataUrl, ssoUrl, scopes, autoProvision, defaultRoleId } = req.body as {
    providerType?: string; name?: string; domain?: string; clientId?: string;
    clientSecret?: string; metadataUrl?: string; ssoUrl?: string;
    scopes?: string[]; autoProvision?: boolean; defaultRoleId?: string;
  };
  if (!providerType || !name) { res.status(400).json({ error: "providerType et name requis" }); return; }

  // Guard: SAML/Okta/Azure not yet production-ready
  if (SAML_ROADMAP_PROVIDERS.has(providerType)) {
    res.status(501).json({
      error: "Not Implemented",
      message: `Le provider SAML "${name}" (${providerType}) est sur la roadmap Enterprise. L'implémentation complète (AuthnRequest / ACS / SAMLResponse) n'est pas encore disponible.`,
      roadmap: "SAML 2.0 complet (Okta, Azure AD, OneLogin) — Enterprise Q3 2026",
      availableNow: ["google_workspace"],
    });
    return;
  }

  try {
    const provider = await createSSOProvider(org(req), plan(req), { providerType, name, domain, clientId, clientSecret, metadataUrl, ssoUrl, scopes, autoProvision, defaultRoleId });
    res.status(201).json({ ok: true, provider });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("requis") ? 403 : 500).json({ error: msg });
  }
});

router.patch("/sso/providers/:id", requireAdmin, async (req, res) => {
  try {
    await updateSSOProvider(org(req), req.params.id, req.body as Partial<{ enabled: boolean; enforce_sso: boolean; domain: string; auto_provision: boolean }>);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.delete("/sso/providers/:id", requireAdmin, async (req, res) => {
  try {
    await deleteSSOProvider(org(req), req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/sso/auth-config", requireAdmin, async (req, res) => {
  try {
    const config = await getOrgAuthConfig(org(req));
    res.json({ config });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.put("/sso/auth-config", requireAdmin, async (req, res) => {
  const { allowedDomains, enforceSso, enforceMfa, sessionTimeout, ipWhitelist, loginMessage } = req.body as {
    allowedDomains?: string[]; enforceSso?: boolean; enforceMfa?: boolean;
    sessionTimeout?: number; ipWhitelist?: string[]; loginMessage?: string;
  };
  try {
    await upsertOrgAuthConfig(org(req), { allowedDomains, enforceSso, enforceMfa, sessionTimeout, ipWhitelist, loginMessage });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/sso/login-audits", requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit as string || "50", 10);
  try {
    const logs = await getLoginAudits(org(req), limit);
    res.json({ logs, count: logs.length });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
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
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.get("/sso/sessions", requireAdmin, async (req, res) => {
  try {
    const data = await getSSODashboard(org(req));
    res.json({ sessions: (data as { active_sessions: unknown[] }).active_sessions });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/sso/sessions/:id/invalidate", requireAdmin, async (req, res) => {
  try {
    await invalidateSession(org(req), req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

// NOTE: SAML ACS, init, metadata, capabilities are on publicSsoRouter (no auth needed).
// See publicSsoRouter export above — registered BEFORE requireAuth in routes/index.ts.

export default router;
