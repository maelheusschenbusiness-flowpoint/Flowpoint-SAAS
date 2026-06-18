import { Router, type Request, type Response } from "express";
import { db, connectorsTable } from "@workspace/db";
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
router.get("/connectors", async (_req, res) => {
  try {
    await ensureSeed();
    const connectors = await db.select().from(connectorsTable).limit(100);
    const safe = connectors.map(c => ({ ...c, accessToken: c.connected ? "••••••" : null, refreshToken: null, webhookSecret: null }));
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch connectors" });
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
  const state = crypto.randomBytes(16).toString("hex");
  const oauthUrls: Record<string, string> = {
    slack: `https://slack.com/oauth/v2/authorize?client_id=YOUR_SLACK_CLIENT_ID&scope=channels:read,chat:write&state=${state}`,
    github: `https://github.com/login/oauth/authorize?client_id=YOUR_GITHUB_CLIENT_ID&scope=repo,read:org&state=${state}`,
    google: process.env["GOOGLE_CLIENT_ID"]
      ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(process.env["GOOGLE_CLIENT_ID"])}&response_type=code&scope=${encodeURIComponent("openid email profile https://www.googleapis.com/auth/business.manage")}&redirect_uri=${encodeURIComponent(process.env["GOOGLE_REDIRECT_URI"] || "")}&access_type=offline&prompt=consent&state=${state}`
      : `https://accounts.google.com/o/oauth2/v2/auth?client_id=CONFIGURE_GOOGLE_CLIENT_ID&response_type=code&scope=openid%20email%20profile&state=${state}`,
    notion: `https://api.notion.com/v1/oauth/authorize?client_id=YOUR_NOTION_CLIENT_ID&response_type=code&owner=user&state=${state}`,
  };
  const url = oauthUrls[provider];
  if (!url) { res.status(400).json({ error: `OAuth not configured for provider: ${provider}` }); return; }
  res.json({ ok: true, url, note: "Configure OAuth credentials in environment variables to enable." });
});

export default router;
