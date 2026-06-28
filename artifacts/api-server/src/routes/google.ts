/**
 * google.ts — OAuth flow + GBP/GA4/GSC management routes
 *
 * Architecture:
 *  - Public router  : /google/callback, /google/oauth/callback (no auth — Google redirects here)
 *  - Protected router: all other /google/* endpoints (require valid JWT)
 *
 * Multi-tenancy:
 *  orgId is embedded in the server-side OAuth state when the user
 *  initiates the flow (authenticated endpoint).  The callback reads it
 *  back from the state map — it never trusts user-supplied input.
 */

import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import crypto from "crypto";
import {
  isGoogleConfigured,
  generateAuthUrl,
  getTokensFromCode,
  saveTokens,
  getValidToken,
  getAccounts,
  getLocations,
  getGBPStatus,
  getPerformance,
  publishGBPPost,
  replyToReview,
  generateAIReply,
  encryptToken,
  syncAll,
} from "../services/google-service.js";
import { discoverAndStoreProperties } from "../services/ga4-service.js";
import { discoverAndStoreSites } from "../services/gsc-service.js";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";

// ── OAuth state store (DB-backed — multi-instance safe) ──────────────────────
// States are persisted in `google_oauth_states` so any server instance can
// validate the callback even if a different instance handled /google/connect.
// Each state is single-use and expires after 10 minutes.

async function registerOAuthState(state: string, orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO google_oauth_states (state, org_id, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')
     ON CONFLICT (state) DO NOTHING`,
    [state, orgId]
  );
  // Opportunistically prune expired states (best-effort)
  pool.query(`DELETE FROM google_oauth_states WHERE expires_at < now()`).catch(() => {});
}

async function consumeOAuthState(state: string): Promise<{ orgId: string } | null> {
  const r = await pool.query(
    `DELETE FROM google_oauth_states
     WHERE state = $1 AND expires_at > now()
     RETURNING org_id`,
    [state]
  );
  if (!r.rows.length) return null;
  return { orgId: r.rows[0].org_id as string };
}

// ── Shared callback handler ───────────────────────────────────────────────────

async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error: oauthError } = req.query as {
    code?: string; state?: string; error?: string;
  };

  const frontendUrl = process.env["FRONTEND_URL"] ?? "https://app.flowpoint.pro";

  if (oauthError) {
    res.redirect(`${frontendUrl}/dashboard?google_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code) {
    res.status(400).json({ ok: false, error: "Missing OAuth code" });
    return;
  }
  if (!state) {
    res.status(400).json({ ok: false, error: "Missing state parameter" });
    return;
  }

  const stateData = await consumeOAuthState(state);
  if (!stateData) {
    logger.warn("[google] OAuth callback rejected — invalid or expired state");
    res.status(400).json({ ok: false, error: "Invalid or expired OAuth state" });
    return;
  }

  const { orgId } = stateData;

  try {
    // Exchange code for tokens — returns camelCase GoogleTokens
    const tokens = await getTokensFromCode(code);

    // Fetch Google user profile
    const userInfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(8_000),
    }).then(r => r.json()) as { sub?: string; email?: string; name?: string };

    // Primary token storage (read by getValidToken)
    await saveTokens(orgId, { ...tokens, email: userInfo.email, name: userInfo.name });

    // Also persist to google_accounts for profile/email display
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO google_accounts (id, org_id, google_id, email, access_token, refresh_token, token_expiry, scopes, connected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (org_id) DO UPDATE SET
           google_id=$3, email=$4, access_token=$5,
           refresh_token=COALESCE($6, google_accounts.refresh_token),
           token_expiry=$7, scopes=$8, updated_at=now()`,
        [
          `ga_${orgId}`, orgId,
          userInfo.sub ?? "",
          userInfo.email ?? "",
          encryptToken(tokens.accessToken),
          tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
          new Date(tokens.expiresAt).toISOString(),
          JSON.stringify(tokens.scope?.split(" ") ?? []),
        ]
      );
    } finally {
      client.release();
    }

    store.logActivity({
      type: "team",
      label: `Google connecté — ${userInfo.email ?? ""}`,
      targetType: "connector",
    });

    // Reflect Google connection in the connectors table (used by the Connectors UI)
    pool.query(
      `INSERT INTO connectors (id, org_id, provider, status, connected, last_sync, sync_status, created_at)
       VALUES ($1, $2, 'google', 'connected', true, NOW(), 'ok', NOW())
       ON CONFLICT (id) DO UPDATE
         SET status='connected', connected=true, last_sync=NOW(), sync_status='ok'`,
      [`conn-google-${orgId}`, orgId]
    ).catch(e => logger.warn({ e }, "[google] Failed to update connectors table"));

    // Kick off background syncs (non-blocking)
    syncAll(orgId).catch(e => logger.warn({ e }, "[google] Background GBP sync failed"));
    discoverAndStoreProperties(orgId).catch(e => logger.warn({ e }, "[google] GA4 property discovery failed"));
    discoverAndStoreSites(orgId).catch(e => logger.warn({ e }, "[google] GSC site discovery failed"));

    res.redirect(`${frontendUrl}/dashboard?google_connected=1`);
  } catch (e) {
    logger.error({ e, orgId }, "[google] OAuth callback failed");
    res.redirect(`${frontendUrl}/dashboard?google_error=oauth_failed`);
  }
}

// ── Public router — unauthenticated callbacks ─────────────────────────────────

export const googlePublicRouter = Router();
googlePublicRouter.get("/google/callback",       handleGoogleCallback);
googlePublicRouter.get("/google/oauth/callback", handleGoogleCallback);

// ── Protected router ──────────────────────────────────────────────────────────

const router = Router();

// Helper to extract orgId from authenticated request
function getOrgId(req: Request): string {
  return (req as unknown as Record<string, string>)["orgId"] ?? "default";
}

// ── Connect / status ──────────────────────────────────────────────────────────

router.get("/google/connect", async (req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    res.status(503).json({
      ok: false,
      error: "Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    });
    return;
  }
  const orgId = getOrgId(req);
  const state = crypto.randomBytes(16).toString("hex");
  await registerOAuthState(state, orgId);
  res.json({ ok: true, url: generateAuthUrl(state), state });
});

router.get("/google/oauth/start", async (req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    res.status(503).json({ ok: false, error: "Google OAuth not configured" });
    return;
  }
  const orgId = getOrgId(req);
  const state = crypto.randomBytes(16).toString("hex");
  await registerOAuthState(state, orgId);
  res.json({ ok: true, url: generateAuthUrl(state), state });
});

router.get("/google/status", async (req: Request, res: Response) => {
  try {
    const status = await getGBPStatus(getOrgId(req));
    res.json(status);
  } catch {
    res.status(500).json({ ok: false, error: "Failed to get Google status" });
  }
});

router.post("/google/disconnect", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const client = await pool.connect();
  try {
    await Promise.all([
      client.query(`DELETE FROM google_accounts WHERE org_id=$1`, [orgId]),
      client.query(`DELETE FROM google_tokens   WHERE org_id=$1`, [orgId]),
    ]);
    store.logActivity({ type: "team", label: "Google déconnecté", targetType: "connector" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to disconnect" });
  } finally {
    client.release();
  }
});

// ── GBP — accounts / locations / reviews ─────────────────────────────────────

router.get("/google/accounts", async (req: Request, res: Response) => {
  try {
    const accounts = await getAccounts(getOrgId(req));
    res.json({ ok: true, accounts });
  } catch (e: any) {
    res.status(e?.message?.includes("not connected") ? 401 : 500)
       .json({ ok: false, error: e?.message ?? "Failed to get accounts" });
  }
});

router.get("/google/locations", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const rows = await client.query(
      `SELECT id, name, primary_category, rating, reviews_count, phone, website, lat, lng, last_sync_at
       FROM google_locations WHERE org_id=$1 ORDER BY name`,
      [getOrgId(req)]
    );
    res.json({ ok: true, locations: rows.rows });
  } catch {
    res.status(500).json({ error: "Failed to get locations" });
  } finally {
    client.release();
  }
});

router.get("/google/reviews/:locationId", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const rows = await client.query(
      `SELECT id, reviewer_name, reviewer_photo, rating, comment, create_time, update_time, reply_comment, reply_updated_at
       FROM google_reviews WHERE org_id=$1 AND location_id=$2 ORDER BY create_time DESC LIMIT 50`,
      [getOrgId(req), req.params["locationId"]]
    );
    res.json({ ok: true, reviews: rows.rows });
  } catch {
    res.status(500).json({ error: "Failed to get reviews" });
  } finally {
    client.release();
  }
});

router.get("/google/reviews", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const rows = await client.query(
      `SELECT id, location_id, reviewer_name, reviewer_photo, rating, comment, create_time, update_time, reply_comment
       FROM google_reviews WHERE org_id=$1 ORDER BY create_time DESC LIMIT 50`,
      [getOrgId(req)]
    );
    res.json({ ok: true, reviews: rows.rows });
  } catch {
    res.status(500).json({ error: "Failed to get reviews" });
  } finally {
    client.release();
  }
});

// ── GBP — sync ────────────────────────────────────────────────────────────────

router.post("/google/sync", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    store.broadcast({ type: "gbp:sync_started" });
    const result = await syncAll(orgId);
    store.broadcast({ type: "gbp:sync_complete", ...result });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error({ e }, "[GBP] Manual sync failed");
    res.status(500).json({ ok: false, error: "Sync failed" });
  }
});

// ── GBP — performance ────────────────────────────────────────────────────────

router.get("/google/performance", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const { locationId } = req.query as { locationId?: string };

  const token = await getValidToken(orgId).catch(() => null);
  if (!token) {
    res.status(401).json({ ok: false, error: "Google account not connected" });
    return;
  }

  try {
    const client = await pool.connect();
    let locationName = locationId ?? "";
    try {
      if (!locationName) {
        const locs = await client.query(
          `SELECT raw_data FROM google_locations WHERE org_id=$1 LIMIT 1`, [orgId]
        );
        locationName = (locs.rows[0]?.raw_data as { name?: string })?.name ?? "";
      }
    } finally {
      client.release();
    }

    if (!locationName) {
      res.json({ ok: true, metrics: [], summary: {} });
      return;
    }

    const metrics = await getPerformance(orgId, locationName, {
      startTime: new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      endTime: new Date().toISOString(),
    });

    const summary: Record<string, number> = {};
    for (const serie of metrics as Array<{
      dailyMetric?: string;
      timeSeries?: { datedValues?: Array<{ value?: number }> };
    }>) {
      const key = serie.dailyMetric ?? "UNKNOWN";
      summary[key] = (serie.timeSeries?.datedValues ?? []).reduce((s, v) => s + (v.value ?? 0), 0);
    }

    res.json({ ok: true, locationName, metrics, summary });
  } catch (e) {
    logger.error({ e }, "[GBP] performance route failed");
    res.status(500).json({ ok: false, error: "Failed to fetch performance data" });
  }
});

// ── GBP — post ────────────────────────────────────────────────────────────────

router.post("/google/post", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const { locationId, text, callToActionType, callToActionUrl } = req.body as {
    locationId?: string; text?: string; callToActionType?: string; callToActionUrl?: string;
  };

  if (!text?.trim()) {
    res.status(400).json({ ok: false, error: "text is required" });
    return;
  }

  let locationName = locationId ?? "";
  if (!locationName) {
    const client = await pool.connect();
    try {
      const locs = await client.query(
        `SELECT raw_data FROM google_locations WHERE org_id=$1 LIMIT 1`, [orgId]
      );
      locationName = (locs.rows[0]?.raw_data as { name?: string })?.name ?? "";
    } finally { client.release(); }
  }

  if (!locationName) {
    res.status(400).json({ ok: false, error: "No location found — sync GBP first." });
    return;
  }

  try {
    const result = await publishGBPPost(orgId, locationName, {
      summary: text,
      callToAction: callToActionType && callToActionUrl
        ? { actionType: callToActionType, url: callToActionUrl }
        : undefined,
    });
    store.logActivity({ type: "ai", label: `Post GBP publié : "${text.slice(0, 60)}…"`, targetType: "google_business" });
    res.json(result);
  } catch (e: any) {
    logger.error({ e }, "[GBP] post failed");
    res.status(500).json({ ok: false, error: e.message ?? "Failed to publish post" });
  }
});

// ── GBP — reply to review ─────────────────────────────────────────────────────

router.post("/google/reply", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const { reviewId, locationId, comment, useAI } = req.body as {
    reviewId?: string; locationId?: string; comment?: string; useAI?: boolean;
  };

  if (!reviewId) {
    res.status(400).json({ ok: false, error: "reviewId is required" });
    return;
  }

  const client = await pool.connect();
  try {
    let finalComment = comment ?? "";

    if (useAI || !finalComment) {
      const rev = await client.query(
        `SELECT reviewer_name, rating, comment FROM google_reviews
         WHERE review_id=$1 AND org_id=$2 LIMIT 1`,
        [reviewId, orgId]
      );
      if (rev.rows.length > 0) {
        const row = rev.rows[0] as { reviewer_name: string; rating: number; comment: string };
        finalComment = await generateAIReply(row.reviewer_name, row.rating, row.comment);
      }
    }

    if (!finalComment) {
      res.status(400).json({ ok: false, error: "comment is required" });
      return;
    }

    let locationName = locationId ?? "";
    if (!locationName) {
      const locs = await client.query(
        `SELECT raw_data FROM google_locations WHERE org_id=$1 LIMIT 1`, [orgId]
      );
      locationName = (locs.rows[0]?.raw_data as { name?: string })?.name ?? "";
    }

    if (!locationName) {
      res.status(400).json({ ok: false, error: "No location found" });
      return;
    }

    await replyToReview(orgId, locationName, reviewId, finalComment);

    await client.query(
      `UPDATE google_reviews SET reply_comment=$1, reply_updated_at=now()
       WHERE review_id=$2 AND org_id=$3`,
      [finalComment, reviewId, orgId]
    );
    store.logActivity({ type: "team", label: `Réponse GBP publiée — avis ${reviewId}`, targetType: "google_business" });
    res.json({ ok: true, reply: finalComment });
  } catch (e: any) {
    logger.error({ e }, "[GBP] reply failed");
    res.status(500).json({ ok: false, error: e.message ?? "Failed to reply" });
  } finally {
    client.release();
  }
});

router.post("/google/ai-reply-preview", async (req: Request, res: Response) => {
  const { reviewId } = req.body as { reviewId?: string };
  if (!reviewId) {
    res.status(400).json({ ok: false, error: "reviewId required" });
    return;
  }
  const client = await pool.connect();
  try {
    const rev = await client.query(
      `SELECT reviewer_name, rating, comment FROM google_reviews
       WHERE review_id=$1 AND org_id=$2 LIMIT 1`,
      [reviewId, getOrgId(req)]
    );
    if (rev.rows.length === 0) {
      res.status(404).json({ ok: false, error: "Review not found" });
      return;
    }
    const row = rev.rows[0] as { reviewer_name: string; rating: number; comment: string };
    const reply = await generateAIReply(row.reviewer_name, row.rating, row.comment);
    res.json({ ok: true, reply });
  } finally {
    client.release();
  }
});

export default router;
