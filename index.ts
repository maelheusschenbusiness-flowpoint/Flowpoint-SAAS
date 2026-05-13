import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import healthRouter from "./health.js";
import shareRouter from "./share.js";
import stripeWebhookRouter from "./stripe-webhook.js";
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
import missionsRouter from "./missions.js";
import keywordsRouter from "./keywords.js";
import competitorsRouter from "./competitors.js";
import notificationsRouter from "./notifications.js";
import teamMessagesRouter from "./team-messages.js";
import connectorsRouter from "./connectors.js";

const router: IRouter = Router();

// ── Public routes (no authentication required) ─────────────────────────────
// Health check is intentionally public for uptime monitoring.
router.use(healthRouter);

// Public share links are designed to be shared externally without credentials.
router.use(shareRouter);

// Stripe webhooks are verified by Stripe's own signature; they must not require
// our API key because Stripe cannot supply it.
router.use(stripeWebhookRouter);

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
router.use(missionsRouter);
router.use(keywordsRouter);
router.use(competitorsRouter);
router.use(notificationsRouter);
router.use(teamMessagesRouter);
router.use(connectorsRouter);

export default router;
