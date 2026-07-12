import { Router, type Request, type Response } from "express";
import { db, connectorsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../services/store.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import crypto from "crypto";

const router = Router();

const SEED: Array<typeof connectorsTable.$inferInsert> = [
  { id: "conn-slack", provider: "slack", status: "disconnected", connected: false, config: '{"webhookUrl":""}' },
  { id: "conn-github", provider: "github", status: "disconnected", connected: false, config: '{"org":""}' },
  { id: "conn-google", provider: "google", status: "disconnected", connected: false, config: '{}' },
  { id: "conn-gsc", provider: "google-search-console", status: "disconnected", connected: false, config: '{}' },
  { id: "conn-ga", provider: "google-analytics", status: "disconnected", connected: false, config: '{}' },
  { id: "conn-notion", provider: "notion", status: "disconnected", connected: false, config: '{}' },
  { id: "conn-discord", provider: "discord", status: "disconnected", connected: false, config: '{"webhookUrl":""}' },
];

async function ensureSeed() {
  const existing = await db.select().from(connectorsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(connectorsTable).values(SEED).onConflictDoNothing();
  }
}

// Read-only: any authenticated user may list connectors (status only, no tokens)
// Real-time Google/GA4/GSC status is overlaid from google_tokens / ga4_properties / gsc_sites.
router.get("/connectors", async (req, res) => {
  const orgId: string = (req as unknown as Record<string, string>)["orgId"] ?? "default";
  try {
    await ensureSeed();
    const [connectors, googleTok, ga4Prop, gscSite] = await Promise.allSettled([
      db.select().from(connectorsTable).limit(100),
      pool.query(`SELECT 1 FROM google_tokens   WHERE org_id=$1 LIMIT 1`, [orgId]),
      pool.query(`SELECT 1 FROM ga4_properties  WHERE org_id=$1 LIMIT 1`, [orgId]),
      pool.query(`SELECT 1 FROM gsc_sites       WHERE org_id=$1 AND active=true LIMIT 1`, [orgId]),
    ]);

    const connList = connectors.status === "fulfilled" ? connectors.value : SEED;
    const googleOK = googleTok.status === "fulfilled" && googleTok.value.rows.length > 0;
    const ga4OK    = ga4Prop.status   === "fulfilled" && ga4Prop.value.rows.length   > 0;
    const gscOK    = gscSite.status   === "fulfilled" && gscSite.value.rows.length   > 0;

    const GOOGLE_PROVIDERS = new Set(["google", "google-business-profile", "gbp"]);
    const GA4_PROVIDERS    = new Set(["google-analytics", "ga4", "google_analytics"]);
    const GSC_PROVIDERS    = new Set(["google-search-console", "gsc"]);

    const safe = connList.map(c => {
      let connected = c.connected ?? false;
      let status    = c.status    ?? "disconnected";

      if (GOOGLE_PROVIDERS.has(c.provider)) {
        connected = googleOK;
        status    = googleOK ? "connected" : "disconnected";
      } else if (GA4_PROVIDERS.has(c.provider)) {
        // GA4 uses the same Google OAuth token; mark connected if either token or property exists
        connected = googleOK || ga4OK;
        status    = (googleOK || ga4OK) ? "connected" : "disconnected";
      } else if (GSC_PROVIDERS.has(c.provider)) {
        connected = googleOK || gscOK;
        status    = (googleOK || gscOK) ? "connected" : "disconnected";
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
  } catch {
    res.json(SEED);
  }
});

// Write operations require admin — connectors are instance-global resources
router.post("/connectors/:provider/connect", requireAdmin, async (req: Request, res: Response) => {
  const { provider } = req.params;
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
      store.logActivity({ type: "team", label: `Connecteur ${provider} connecté`, targetType: "connector" }).catch(() => {});
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
      store.logActivity({ type: "team", label: `Connecteur ${provider} connecté`, targetType: "connector" }).catch(() => {});
      res.status(201).json({ ok: true, connector: { ...created, accessToken: "••••••", webhookSecret: null } });
    }
  } catch (e) {
    res.status(500).json({ error: "Failed to connect" });
  }
});

router.post("/connectors/:provider/disconnect", requireAdmin, async (req: Request, res: Response) => {
  const { provider } = req.params;
  try {
    await db.update(connectorsTable).set({
      status: "disconnected", connected: false, accessToken: null, refreshToken: null, webhookSecret: null, syncStatus: "idle",
    }).where(eq(connectorsTable.provider, provider));
    store.logActivity({ type: "team", label: `Connecteur ${provider} déconnecté`, targetType: "connector" }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.post("/connectors/:provider/sync", requireAdmin, async (req: Request, res: Response) => {
  const { provider } = req.params;
  try {
    const [conn] = await db.update(connectorsTable).set({
      syncStatus: "ok", lastSync: new Date().toISOString(),
    }).where(eq(connectorsTable.provider, provider)).returning();
    if (!conn) { res.status(404).json({ error: "Connector not found" }); return; }
    store.broadcast({ type: "connector:synced", provider, lastSync: conn.lastSync });
    res.json({ ok: true, lastSync: conn.lastSync });
  } catch (e) {
    res.status(500).json({ error: "Failed to sync" });
  }
});

// Slack and GitHub webhooks are externally invoked — no session credential available
router.post("/connectors/slack/webhook", async (req: Request, res: Response) => {
  const { challenge, event, type } = req.body as { challenge?: string; event?: { type: string; text: string; user: string }; type?: string };
  if (challenge) { res.json({ challenge }); return; }
  if (type === "event_callback" && event) {
    store.broadcast({ type: "slack:message", text: event.text, user: event.user });
    store.logActivity({ type: "team", label: `Slack: ${event.text?.slice(0, 80) || "message reçu"}`, targetType: "slack" }).catch(() => {});
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
  store.logActivity({ type: "team", label, targetType: "github" }).catch(() => {});
  store.broadcast({ type: "github:event", eventType, action, repo: repository?.name });
  res.json({ ok: true });
});

router.get("/connectors/:provider/oauth/start", requireAdmin, async (req: Request, res: Response) => {
  const { provider } = req.params;
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
