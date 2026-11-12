import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { resolveOrgId } from "../lib/resolve-org-id.js";
import { logger } from "../lib/logger.js";
import {
  buildGscAuthUrl, createGscState, consumeGscState, exchangeGscCode,
  encryptGscToken, gscPropertyUrl, gscRedirectUri, saveGscTokens, verifyGscProperty,
} from "../services/gsc-oauth-service.js";

export const gscOAuthPublicRouter = Router();
export const gscOAuthRouter = Router();

gscOAuthRouter.get("/google/gsc/connect", async (req: Request, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    // Fail closed before redirecting if the independent encryption key is absent.
    encryptGscToken("configuration-check");
    const state = randomBytes(32).toString("hex");
    await createGscState(orgId, state);
    res.json({ ok: true, url: buildGscAuthUrl(state), redirectUri: gscRedirectUri() });
  } catch (error) {
    logger.warn({ error }, "[gsc] OAuth initiation failed");
    res.status(503).json({ ok: false, error: "GSC OAuth is not configured or temporarily unavailable" });
  }
});

gscOAuthPublicRouter.get("/google/gsc/callback", async (req: Request, res: Response) => {
  const frontend = process.env["FRONTEND_URL"] ?? "https://app.flowpoint.pro";
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) { res.redirect(`${frontend}/dashboard?gsc_error=consent_denied`); return; }
  if (!code || !state || !/^[a-f\d]{64}$/i.test(state)) {
    res.status(400).json({ ok: false, error: "Invalid OAuth callback" }); return;
  }
  try {
    const orgId = await consumeGscState(state);
    if (!orgId) { res.status(400).json({ ok: false, error: "Invalid or expired OAuth state" }); return; }
    const tokens = await exchangeGscCode(code);
    const accessToken = String(tokens["access_token"] ?? "");
    if (!accessToken) throw new Error("Missing access token");
    const { url, email, permissionLevel } = await verifyGscProperty(accessToken);
    await saveGscTokens(orgId, tokens, email, url);
    await pool.query(`UPDATE gsc_sites SET is_active=false WHERE org_id=$1`, [orgId]);
    await pool.query(
      `INSERT INTO gsc_sites (id,org_id,site_url,display_name,permission_level,is_active,created_at)
       VALUES ($1,$2,$3,$3,$4,true,NOW())
       ON CONFLICT (org_id,site_url) DO UPDATE SET is_active=true,permission_level=$4,updated_at=NOW()`,
      [`gsc_${orgId}_${Buffer.from(url).toString("base64url").slice(0,40)}`, orgId, url, permissionLevel]
    );
    res.redirect(`${frontend}/dashboard?gsc_connected=1`);
  } catch (cause) {
    logger.warn({ message: cause instanceof Error ? cause.message : "unknown" }, "[gsc] OAuth callback failed");
    res.redirect(`${frontend}/dashboard?gsc_error=oauth_failed`);
  }
});

