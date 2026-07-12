import { Router, type IRouter } from "express";
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
import teamRouter from "./team.js";
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

// SSE real-time event stream — must be public so the dashboard can subscribe
// before the user is authenticated (shows live monitor status on login page too).
router.use(eventsRouter);

// Public Stripe checkout session — pricing.html public tunnel, no auth required.
router.use(publicBillingRouter);

// Public plan definitions — all frontend surfaces read from here.
router.use(plansRouter);

// ── Protected routes (authentication required) ─────────────────────────────
// All management endpoints require a valid API secret supplied via:
//   Authorization: Bearer <secret>   or   X-Api-Key: <secret>
router.use(requireAuth);

router.use(meRouter);
router.use(overviewRouter);
router.use(auditsRouter);
router.use(monitorsRouter);
router.use(reportsRouter);
router.use(teamRouter);
router.use(aiRouter);
router.use(billingRouter);
router.use(alertRulesRouter);
router.use(activityRouter);
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
router.use(pagespeedRouter);
router.use(githubRouter);
router.use(gscRouter);
router.use(betterstackRouter);
router.use(diagnosticsRouter);
router.use(locationRouter);
router.use(growthObjectivesRouter);

export default router;
