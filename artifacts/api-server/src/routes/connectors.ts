import { Router, type Request, type Response } from "express";
import { db, connectorsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import crypto from "crypto";
import { SYSTEM_CONNECTOR_SEEDS } from "../services/canonical-system-seeds.js";
import { logger } from "../lib/logger.js";

const router = Router();

const SEED: Array<typeof connectorsTable.$inferInsert> = SYSTEM_CONNECTOR_SEEDS.map((connector) => ({
  ...connector,
  status: "disconnected",
  connected: false,
}));

async function ensureSeed() {
  const existing = await db.select().from(connectorsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(connectorsTable).values(SEED).onConflictDoNothing();
  }
}

// Read-only: any authenticated user may list connectors (status only, no tokens)
// Real-time Google/GA4/GSC status is overlaid from google_tokens / ga4_properties / gsc_sites.
router.get("/connectors", async (req, res) => {
  // Use the org context set by middleware — never fall back to "default"
  const orgId: string | undefined = req.orgContext?.orgId ?? req.orgId;

  try {
    await ensureSeed();

    // Only do per-org Google lookups when we have a real org
    const hasOrg = !!orgId && orgId !== "default";

    const [connectors, googleTok, ga4Prop, gscSite, gbpFlag, ga4Flag, gscFlag] = await Promise.allSettled([
      db.select().from(connectorsTable).limit(100),
      hasOrg
        ? pool.query(`SELECT 1 FROM google_tokens WHERE org_id=$1 LIMIT 1`, [orgId])
        : Promise.resolve({ rows: [] }),
      hasOrg
        // is_active=true: token presence + active property = truly connected
        ? pool.query(`SELECT 1 FROM ga4_properties WHERE org_id=$1 AND is_active=true LIMIT 1`, [orgId])
        : Promise.resolve({ rows: [] }),
      hasOrg
        // is_active=true (correct column — not "active")
        ? pool.query(`SELECT 1 FROM gsc_sites WHERE org_id=$1 AND is_active=true LIMIT 1`, [orgId])
        : Promise.resolve({ rows: [] }),
      hasOrg
        ? pool.query(`SELECT connected FROM google_product_connections WHERE org_id=$1 AND product='gbp' LIMIT 1`, [orgId])
        : Promise.resolve({ rows: [] }),
      hasOrg
        ? pool.query(`SELECT connected FROM google_product_connections WHERE org_id=$1 AND product='ga4' LIMIT 1`, [orgId])
        : Promise.resolve({ rows: [] }),
      hasOrg
        ? pool.query(`SELECT connected FROM google_product_connections WHERE org_id=$1 AND product='gsc' LIMIT 1`, [orgId])
        : Promise.resolve({ rows: [] }),
    ]);

    const connList = connectors.status === "fulfilled" ? connectors.value : SEED;
    if (connectors.status === "rejected") {
      logger.warn({ err: connectors.reason }, "[connectors] GET /connectors: DB query failed, using seed");
    }

    const googleOK = googleTok.status === "fulfilled" && (googleTok.value as { rows: unknown[] }).rows.length > 0;
    // GA4: token present + active property in DB = connected; token only = discovering (not yet connected)
    const ga4OK    = ga4Prop.status   === "fulfilled" && (ga4Prop.value   as { rows: unknown[] }).rows.length > 0;
    const gscOK    = gscSite.status   === "fulfilled" && (gscSite.value   as { rows: unknown[] }).rows.length > 0;

    // Per-product disconnect flags
    const gbpFlagRow = gbpFlag.status === "fulfilled" ? ((gbpFlag.value as { rows: Array<{ connected: boolean }> }).rows[0]) : undefined;
    const ga4FlagRow = ga4Flag.status === "fulfilled" ? ((ga4Flag.value as { rows: Array<{ connected: boolean }> }).rows[0]) : undefined;
    const gscFlagRow = gscFlag.status === "fulfilled" ? ((gscFlag.value as { rows: Array<{ connected: boolean }> }).rows[0]) : undefined;

    // A product is disconnected if its flag is explicitly false
    const gbpDisconnected = gbpFlagRow !== undefined && !gbpFlagRow.connected;
    const ga4Disconnected = ga4FlagRow !== undefined && !ga4FlagRow.connected;
    const gscDisconnected = gscFlagRow !== undefined && !gscFlagRow.connected;

    const GOOGLE_PROVIDERS = new Set(["google", "google-business-profile", "gbp"]);
    const GA4_PROVIDERS    = new Set(["google-analytics", "ga4", "google_analytics"]);
    const GSC_PROVIDERS    = new Set(["google-search-console", "gsc"]);

    const safe = connList.map(c => {
      let connected = c.connected ?? false;
      let status    = c.status    ?? "disconnected";

      if (GOOGLE_PROVIDERS.has(c.provider)) {
        connected = !gbpDisconnected && googleOK;
        status    = connected ? "connected" : "disconnected";
      } else if (GA4_PROVIDERS.has(c.provider)) {
        // Token presence = connected (discovering allowed); respect disconnect flag
        connected = !ga4Disconnected && (ga4OK || googleOK);
        status    = connected ? "connected" : "disconnected";
      } else if (GSC_PROVIDERS.has(c.provider)) {
        // Active site = connected; token only = discovering; respect disconnect flag
        connected = !gscDisconnected && (gscOK || googleOK);
        status    = connected ? "connected" : "disconnected";
      }

      return {
        ...c,
        connected,
        status,
        accessToken:   connected ? "••••••" : null,
        refreshToken:  null,
        webhookSecret: null,
      };
    });

    res.json(safe);
  } catch (err) {
    logger.error({ err }, "[connectors] GET /connectors: unexpected error, returning seed");
    res.json(SEED);
  }
});

// Write operations require admin — connectors are instance-global resources
router.post("/connectors/:provider/connect", requireAdmin, async (req: Request, res: Response) => {
  const provider = String(req.params["provider"]);
  const { webhookUrl, accessToken, config } = req.body as { webhookUrl?: string; accessToken?: string; config?: Record<string, unknown> };

  try {
    const existing = await db.select().from(connectorsTable).where(eq(connectorsTable.provider, provider)).limit(1);
    const secret = crypto.randomBytes(32).toString("hex");
    const configStr = JSON.stringify({ webhookUrl, ...(config || {}) });

    if (existing.length > 0) {
      const [updated] = await db.update(connectorsTable).set({
        status: "connected",
        connected: true,
        accessToken: accessToken || existing[0].accessToken,
        webhookSecret: secret,
        config: configStr,
        lastSync: new Date().toISOString(),
        syncStatus: "ok",
      }).where(eq(connectorsTable.provider, provider)).returning();
      const _cCtx1 = (req as any).orgContext || {};
      store.logActivity({ type: "team", label: `Connecteur ${provider} connecté`, targetType: "connector", orgId: (req as unknown as Record<string, string>)["orgId"] ?? "default",
        actionKey: "activity.connector.connected", actionParams: { provider },
        userId: _cCtx1.userId || _cCtx1.email || null, userName: _cCtx1.name || _cCtx1.email || null }).catch(err => console.warn("[logActivity]", err?.message));
      res.json({ ok: true, connector: { ...updated, accessToken: "••••••", webhookSecret: null } });
    } else {
      const [created] = await db.insert(connectorsTable).values({
        id: "conn-" + provider + "-" + Date.now(),
        provider,
        status: "connected",
        connected: true,
        accessToken: accessToken || null,
        webhookSecret: secret,
        config: configStr,
        lastSync: new Date().toISOString(),
        syncStatus: "ok",
      }).returning();
      const _cCtx2 = (req as any).orgContext || {};
      store.logActivity({ type: "team", label: `Connecteur ${provider} connecté`, targetType: "connector", orgId: (req as unknown as Record<string, string>)["orgId"] ?? "default",
        actionKey: "activity.connector.connected", actionParams: { provider },
        userId: _cCtx2.userId || _cCtx2.email || null, userName: _cCtx2.name || _cCtx2.email || null }).catch(err => console.warn("[logActivity]", err?.message));
      res.status(201).json({ ok: true, connector: { ...created, accessToken: "••••••", webhookSecret: null } });
    }
  } catch (e) {
    res.status(500).json({ error: "Failed to connect" });
  }
});

router.post("/connectors/:provider/disconnect", requireAdmin, async (req: Request, res: Response) => {
  const provider = String(req.params["provider"]);
  try {
    await db.update(connectorsTable).set({
      status: "disconnected", connected: false, accessToken: null, refreshToken: null, webhookSecret: null, syncStatus: "idle",
    }).where(eq(connectorsTable.provider, provider));
    const _cCtxD = (req as any).orgContext || {};
    store.logActivity({ type: "team", label: `Connecteur ${provider} déconnecté`, targetType: "connector", orgId: (req as unknown as Record<string, string>)["orgId"] ?? "default",
      actionKey: "activity.connector.disconnected", actionParams: { provider },
      userId: _cCtxD.userId || _cCtxD.email || null, userName: _cCtxD.name || _cCtxD.email || null }).catch(err => console.warn("[logActivity]", err?.message));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.post("/connectors/:provider/sync", requireAdmin, async (req: Request, res: Response) => {
  const provider = String(req.params["provider"]);
  const syncOrgId: string = (req as unknown as Record<string, string>)["orgId"] ?? "default";
  try {
    const [conn] = await db.update(connectorsTable).set({
      syncStatus: "ok", lastSync: new Date().toISOString(),
    }).where(eq(connectorsTable.provider, provider)).returning();
    if (!conn) { res.status(404).json({ error: "Connector not found" }); return; }
    store.broadcast({ type: "connector:synced", provider, lastSync: conn.lastSync }, syncOrgId);
    res.json({ ok: true, lastSync: conn.lastSync });
  } catch (e) {
    res.status(500).json({ error: "Failed to sync" });
  }
});

// Slack and GitHub webhooks are invoked externally by third-party systems that
// carry no FlowPoint auth header.  We attempt to resolve the org via the
// connector's stored webhook secret (if the platform is multi-tenant and
// connectors include an org_id column).  Until that column exists, we fan-out
// only to "default" — the correct behaviour for single-tenant deploys, and the
// safest fallback for multi-tenant (event is not silently dropped).
async function resolveConnectorOrg(provider: string): Promise<string> {
  try {
    const { pool: pgPool } = await import("@workspace/db");
    const row = await pgPool.query<{ org_id: string }>(
      `SELECT org_id FROM connectors WHERE provider = $1 AND org_id IS NOT NULL LIMIT 1`,
      [provider]
    );
    return row.rows[0]?.org_id ?? "default";
  } catch {
    return "default";
  }
}

router.post("/connectors/slack/webhook", async (req: Request, res: Response) => {
  const { challenge, event, type } = req.body as { challenge?: string; event?: { type: string; text: string; user: string }; type?: string };
  if (challenge) { res.json({ challenge }); return; }
  if (type === "event_callback" && event) {
    const slackOrgId = await resolveConnectorOrg("slack");
    store.broadcast({ type: "slack:message", text: event.text, user: event.user }, slackOrgId);
    store.logActivity({ type: "team", label: `Slack: ${event.text?.slice(0, 80) || "message reçu"}`, targetType: "slack", orgId: slackOrgId }).catch(err => console.warn("[logActivity]", err?.message));
  }
  res.json({ ok: true });
});

router.post("/connectors/github/webhook", async (req: Request, res: Response) => {
  const eventType = req.headers["x-github-event"] as string || "unknown";
  const { action, repository, pull_request, pusher } = req.body as {
    action?: string; repository?: { name: string }; pull_request?: { title: string }; pusher?: { name: string };
  };
  const label = pull_request
    ? `GitHub PR: ${pull_request.title?.slice(0, 60)} (${action})`
    : `GitHub ${eventType}: ${repository?.name || ""} — ${pusher?.name || ""}`;
  const githubOrgId = await resolveConnectorOrg("github");
  store.logActivity({ type: "team", label, targetType: "github", orgId: githubOrgId }).catch(err => console.warn("[logActivity]", err?.message));
  store.broadcast({ type: "github:event", eventType, action, repo: repository?.name }, githubOrgId);
  res.json({ ok: true });
});

router.get("/connectors/:provider/oauth/start", requireAdmin, async (req: Request, res: Response) => {
  const provider = String(req.params["provider"]);
  // For Google providers, delegate to /api/google/connect which uses the full
  // scope set (GSC + GA4 + GBP + openid) and DB-backed state storage.
  if (["google", "google-analytics", "google-search-console", "gbp", "ga4", "gsc"].includes(provider)) {
    res.redirect(307, "/api/google/connect");
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  const clientIds: Record<string, string | undefined> = {
    slack:  process.env.SLACK_CLIENT_ID,
    github: process.env.GITHUB_CLIENT_ID,
    notion: process.env.NOTION_CLIENT_ID,
  };
  const clientId = clientIds[provider];
  if (!clientId) {
    res.status(400).json({ error: `OAuth non configuré pour ${provider}. Définissez ${provider.toUpperCase()}_CLIENT_ID dans les variables d'environnement.` });
    return;
  }
  const oauthUrls: Record<string, string> = {
    slack:  `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=channels:read,chat:write&state=${state}`,
    github: `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:org&state=${state}`,
    notion: `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&state=${state}`,
  };
  const url = oauthUrls[provider];
  if (!url) { res.status(400).json({ error: `OAuth not configured for provider: ${provider}` }); return; }
  res.json({ ok: true, url, state, note: "Conservez le state côté client pour validation au retour OAuth." });
});

export default router;
