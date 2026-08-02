import { Router, type Request, type Response, type NextFunction, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import healthRouter from "./health.js";
import eventsRouter from "./events.js";
import shareRouter from "./share.js";
import stripeWebhookRouter from "./stripe-webhook.js";
import authRouter from "./auth.js";
import meRouter from "./me.js";
import overviewRouter from "./overview.js";
import auditsRouter from "./audits.js";
import monitorsRouter from "./monitors.js";
import reportsRouter from "./reports.js";
import teamRouter, { publicTeamRouter } from "./team.js";
import aiRouter from "./ai.js";
import billingRouter from "./billing.js";
import alertRulesRouter from "./alert-rules.js";
import activityRouter from "./activity.js";
import calendarEventsRouter from "./calendar-events.js";
import missionsRouter from "./missions.js";
import keywordsRouter from "./keywords.js";
import competitorsRouter from "./competitors.js";
import notificationsRouter from "./notifications.js";
import teamMessagesRouter from "./team-messages.js";
import teamFilesRouter from "./team-files.js";
import connectorsRouter from "./connectors.js";
import addonsRouter from "./addons.js";
import aiCreditsRouter from "./ai-credits.js";
import behavioralRouter, { publicBehavioralRouter } from "./behavioral.js";
import croRouter from "./cro.js";
import revenueleakRouter from "./revenue-leak.js";
import forecastRouter from "./forecast.js";
import automationRouter from "./automation.js";
import integrationsRouter from "./integrations.js";
import crmRouter from "./crm.js";
import permissionsRouter from "./permissions.js";
import marketIntelRouter from "./market-intelligence.js";
import reviewIntelRouter from "./review-intelligence.js";
import gbpPostsRouter from "./gbp-posts.js";
import localMapsRouter from "./local-maps.js";
import ssoRouter, { publicSsoRouter } from "./sso.js";
import whiteLabelRouter from "./white-label.js";
import aiWorkspaceLaunchRouter from "./ai-workspace-launch.js";
import googleRouter, { googlePublicRouter } from "./google.js";
import seoRouter from "./seo.js";
import mapsRouter from "./maps.js";
import ga4Router from "./ga4.js";
import funnelsRouter from "./funnels.js";
import pagespeedRouter from "./pagespeed.js";
import githubRouter from "./github.js";
import gscRouter from "./gsc.js";
import betterstackRouter from "./betterstack.js";
import diagnosticsRouter from "./diagnostics.js";
import adminRouter from "./admin.js";
import locationRouter from "./location.js";
import publicBillingRouter from "./public-billing.js";
import growthObjectivesRouter from "./growth-objectives.js";
import plansRouter from "./plans.js";
import securityRouter from "./security.js";
import { qaFixturesRouter, publicQaRouter, isQaFixturesEnabled } from "./qa-fixtures.js";
import analyticsRouter from "./analytics.js";
import trafficRouter from "./traffic.js";
import campaignsRouter from "./campaigns.js";
import audienceRouter from "./audience.js";
import liveRouter from "./live.js";
import conversionRouter from "./conversion.js";
import dataExplorerRouter from "./data-explorer.js";
import clientModeRouter from "./client-mode.js";

const router: IRouter = Router();

// ── Public routes (no authentication required) ─────────────────────────────
// Health check is intentionally public for uptime monitoring.
router.use(healthRouter);

// Public share links are designed to be shared externally without credentials.
router.use(shareRouter);

// Stripe webhooks are verified by Stripe's own signature; they must not require
// our API key because Stripe cannot supply it.
router.use(stripeWebhookRouter);

// Magic-link authentication: POST /auth/login-request, POST /auth/register,
// GET /auth/login-verify — all public, no API key required.
router.use(authRouter);

// Public Stripe config (publishable key, billing/config) — no API key required.
router.get("/billing/config", (_req, res) => {
  res.json({ publishableKey: process.env["STRIPE_PUBLISHABLE_KEY"] ?? process.env["PUBLIC_STRIPE_API_KEY"] ?? "" });
});

// Google OAuth callbacks — must be public; Google redirects here without our Bearer token.
// All other /google/* management routes are protected below after requireAuth.
router.use(googlePublicRouter);

// Admin routes — protected by x-admin-key header (not user session).
// Must be registered before requireAuth so ops scripts don't need a user session.
router.use(adminRouter);

// Behavioral tracking endpoints — called from external client-side JS snippets;
// must be public (no API key from browser context possible).
router.use(publicBehavioralRouter);

// SSO public endpoints — SAML ACS/init/metadata called by external IdPs,
// capabilities is a public disclosure endpoint.
router.use(publicSsoRouter);

// Public Stripe checkout session — pricing.html public tunnel, no auth required.
router.use(publicBillingRouter);

// Public plan definitions — all frontend surfaces read from here.
router.use(plansRouter);

// QA fixture probe — GET /qa/fixture/:id is called directly by monitors during tests.
// Must be public (monitors fetch URLs without auth headers). Always 404 in production.
router.use(publicQaRouter);

// Team invitation public endpoints — validate and accept use a cryptographic token,
// no session required. Must be before requireAuth.
router.use(publicTeamRouter);

// ── Protected routes (authentication required) ─────────────────────────────
// All management endpoints require a valid API secret supplied via:
//   Authorization: Bearer <secret>   or   X-Api-Key: <secret>
router.use(requireAuth);

// Block any request that passed auth but lacks a valid org context.
// Service credential security model:
//   - userId="service" is ONLY valid when it comes from the real API_SECRET_KEY via
//     the X-Api-Key header — not from a forged Bearer session in the DB.
//   - Service credential is restricted to explicit internal routes only (POST /alert-events).
//   - Any attempt to use a Bearer token whose DB session has user_id="service" is rejected
//     with 401 because req.headers["x-api-key"] will not equal the service secret.
router.use((req: Request, res: Response, next: NextFunction) => {
  const serviceSecret = process.env["API_SECRET_KEY"];
  const isProduction  = process.env["NODE_ENV"] === "production";
  if (!serviceSecret && !isProduction) { next(); return; }

  if (req.userId === "service") {
    // Verify the credential arrived via X-Api-Key, not a forged Bearer DB session.
    const apiKeyHeader = req.headers["x-api-key"];
    if (!serviceSecret || typeof apiKeyHeader !== "string" || apiKeyHeader !== serviceSecret) {
      // userId="service" came from a Bearer session — reject as fraudulent.
      res.status(401).json({ error: "Unauthorized: invalid credentials" });
      return;
    }
    // Service credential is restricted to explicitly internal routes only.
    // All ordinary user routes return 403 — the key must never read user data.
    const isInternalRoute = (req.method === "POST" && req.path === "/alert-events") ||
      (req.method === "POST" && req.path === "/qa/billing/activate-signup") ||
      (req.method === "POST" && req.path === "/qa/fixtures/tool") ||
      (req.method === "POST" && req.path === "/qa/permissions-test") ||
      (req.method === "POST" && req.path === "/qa/gemini-finish-reason") ||
      (req.method === "POST" && req.path === "/qa/inject-checks") ||
      (req.method === "POST" && req.path === "/qa/fixture") ||
      (req.method === "POST" && req.path === "/qa/ga4-funnel-base-url");
    // QA injection: allow POST /monitors/:id/check ONLY when the request body
    // explicitly carries a _qa_result field (service-only injection path).
    // isQaFixturesEnabled() is NOT checked here — handleCheck does that and
    // returns 404 when fixtures are disabled. Keeping the guard out of the
    // middleware ensures the caller receives 404 (not 403) when fixtures are off.
    const bodyHasQaResult = !!(req.body as Record<string, unknown> | undefined)?.["_qa_result"];
    const isQaMonitorCheck =
      bodyHasQaResult &&
      req.method === "POST" &&
      /^\/monitors\/[^/]+\/check$/.test(req.path);
    if (!isInternalRoute && !isQaMonitorCheck) {
      res.status(403).json({ error: "Service credential: route not permitted" });
      return;
    }
    next();
    return;
  }

  const orgId = req.orgContext?.orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Unauthorized: no valid organization context" });
    return;
  }
  next();
});

router.use(meRouter);
router.use(overviewRouter);
router.use(auditsRouter);
router.use(monitorsRouter);
router.use(reportsRouter);
router.use(teamRouter);
router.use(aiRouter);
router.use(billingRouter);
router.use(alertRulesRouter);
router.use(qaFixturesRouter);
router.use(activityRouter);
// SSE real-time event stream — authentifié et scopé par org_id (après requireAuth)
router.use(eventsRouter);
router.use(calendarEventsRouter);
router.use(missionsRouter);
router.use(keywordsRouter);
router.use(competitorsRouter);
router.use(notificationsRouter);
router.use(teamMessagesRouter);
router.use(teamFilesRouter);
router.use(connectorsRouter);
router.use(addonsRouter);
router.use(aiCreditsRouter);
router.use(behavioralRouter);
router.use(croRouter);
router.use(revenueleakRouter);
router.use(forecastRouter);
router.use(automationRouter);
router.use(integrationsRouter);
router.use(crmRouter);
router.use(permissionsRouter);
router.use(marketIntelRouter);
router.use(reviewIntelRouter);
router.use(gbpPostsRouter);
router.use(localMapsRouter);
router.use(ssoRouter);
router.use(whiteLabelRouter);
router.use(aiWorkspaceLaunchRouter);
router.use(googleRouter);
router.use(seoRouter);
router.use(mapsRouter);
router.use(ga4Router);
router.use(funnelsRouter);
router.use(pagespeedRouter);
router.use(githubRouter);
router.use(gscRouter);
router.use(betterstackRouter);
router.use(diagnosticsRouter);
router.use(locationRouter);
router.use(securityRouter);
router.use(growthObjectivesRouter);
router.use("/analytics", analyticsRouter);
router.use("/traffic",   trafficRouter);
router.use("/campaigns", campaignsRouter);
router.use("/audience",    audienceRouter);
router.use("/live",        liveRouter);
router.use("/conversion",  conversionRouter);
router.use("/data-explorer", dataExplorerRouter);
router.use("/client-mode", clientModeRouter);

export default router;
