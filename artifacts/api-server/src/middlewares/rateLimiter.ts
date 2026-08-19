/**
 * FlowPoint — In-memory sliding window rate limiter
 * Per-org isolation, per-endpoint buckets, plan-aware limits.
 * No Redis dependency — works in single-node deployments.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { getRateLimit, type RateLimits } from "../lib/config.js";
import { pool } from "@workspace/db";
import { store } from "../services/store.js";

interface Window {
  count: number;
  windowStart: number;
}

const windows = new Map<string, Window>();

// Sweep expired windows every 2 minutes
const sweepInterval = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, w] of windows) {
    if (now - w.windowStart > 120_000) { windows.delete(key); removed++; }
  }
  if (removed > 0) logger.debug({ removed }, '[RateLimit] Swept expired windows');
}, 120_000);
if (sweepInterval.unref) sweepInterval.unref();

function checkRate(key: string, limitPerMinute: number): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const existing = windows.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limitPerMinute - 1, resetInMs: windowMs };
  }

  existing.count++;
  const resetInMs = windowMs - (now - existing.windowStart);
  const remaining = Math.max(0, limitPerMinute - existing.count);
  return { allowed: existing.count <= limitPerMinute, remaining, resetInMs };
}

function getOrgId(req: Request): string {
  return (req as { orgId?: string }).orgId ?? 'default';
}

async function getPlanForOrg(orgId: string): Promise<string> {
  if (orgId === "default") return (store.me?.plan || "standard").toLowerCase();
  try {
    const client = await pool.connect();
    try {
      // Source primaire : organizations
      const r = await client.query<{ plan: string }>(
        `SELECT plan FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId],
      );
      if (r.rows.length > 0) return (r.rows[0].plan || "standard").toLowerCase();
      // Fallback : org_settings
      const legacy = await client.query<{ plan: string }>(
        `SELECT plan FROM org_settings WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );
      return (legacy.rows[0]?.plan || "standard").toLowerCase();
    } finally {
      client.release();
    }
  } catch {
    return (store.me?.plan || "standard").toLowerCase();
  }
}

/** General API rate limiter (global per org) */
export function globalRateLimit(req: Request, res: Response, next: NextFunction): void {
  // Authenticated GET requests are read-only dashboard loads — never rate-limited
  // globally. Rate limiting is reserved for writes and unauthenticated requests.
  const orgId = getOrgId(req);
  if (req.method === 'GET' && orgId !== 'default') {
    next();
    return;
  }

  void (async () => {
    try {
      const plan = await getPlanForOrg(orgId);
      const limit = getRateLimit(plan, 'globalPerMinute');
      const key = `global:${orgId}`;
      const { allowed, remaining, resetInMs } = checkRate(key, limit);

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetInMs / 1000)));

      if (!allowed) {
        logger.warn({ orgId, plan, limit }, '[RateLimit] Global limit exceeded');
        res.status(429).json({ ok: false, error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: Math.ceil(resetInMs / 1000) } });
        return;
      }
      next();
    } catch { next(); }
  })();
}

/**
 * Shared implementation for the AI limiters.
 *
 * Two DISTINCT buckets share the same plan-aware `aiPerMinute` threshold:
 *  - `ai:${orgId}`      — batch/background AI endpoints (summary, audit,
 *                         pagespeed-insights, missions, generate, …)
 *  - `ai:chat:${orgId}` — the interactive conversation endpoint /ai/chat
 *
 * WHY (Task #614 — premature 429): with a single shared bucket, background
 * dashboard AI features silently drained the interactive chat budget, so a
 * normal 15–20 message conversation could hit 429 even though the user never
 * exceeded the chat limit itself. Splitting the buckets keeps every plan
 * threshold identical (no limits were raised) while making each 429
 * attributable to the surface that actually caused it.
 */
function aiLimitMiddleware(bucketPrefix: string, source: string) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const orgId = getOrgId(req);
    void (async () => {
      try {
        const plan = await getPlanForOrg(orgId);
        const limit = getRateLimit(plan, 'aiPerMinute');
        const { allowed, remaining, resetInMs } = checkRate(`${bucketPrefix}:${orgId}`, limit);

        res.setHeader('X-AI-RateLimit-Remaining', String(remaining));

        if (!allowed) {
          // Structured attribution: every AI 429 must be traceable to its
          // source bucket (interactive chat vs batch AI features).
          logger.warn({ orgId, plan, limit, source, bucket: `${bucketPrefix}:${orgId}`, path: req.path }, '[RateLimit] AI limit exceeded');
          res.status(429).json({ ok: false, error: 'AI rate limit exceeded', code: 'AI_RATE_LIMIT', details: { retryAfterSeconds: Math.ceil(resetInMs / 1000), plan, limit, source } });
          return;
        }
        next();
      } catch { next(); }
    })();
  };
}

/** AI endpoint rate limiter — batch/background AI feature endpoints */
export const aiRateLimit = aiLimitMiddleware('ai', 'ai_batch');

/** Interactive conversation limiter — POST /ai/chat only (own bucket) */
export const aiChatRateLimit = aiLimitMiddleware('ai:chat', 'ai_chat');

/** Factory: create a rate limiter for a specific endpoint type */
export function createRateLimit(bucket: keyof RateLimits): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const orgId = getOrgId(req);
    void (async () => {
      try {
        const plan = await getPlanForOrg(orgId);
        const limit = getRateLimit(plan, bucket);
        const { allowed, remaining, resetInMs } = checkRate(`${bucket}:${orgId}`, limit);

        if (!allowed) {
          res.status(429).json({ ok: false, error: `Rate limit exceeded for ${bucket}`, code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: Math.ceil(resetInMs / 1000), bucket } });
          return;
        }
        res.setHeader(`X-RateLimit-${bucket}`, String(remaining));
        next();
      } catch { next(); }
    })();
  };
}

export const reportRateLimit  = createRateLimit('reportsPerHour');
export const exportRateLimit  = createRateLimit('exportsPerHour');
export const webhookRateLimit = createRateLimit('webhooksPerMinute');

/**
 * Strict per-IP rate limiter for auth endpoints (login, register).
 * 10 attempts per 15 minutes per IP — prevents brute-force and credential stuffing.
 */
export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.ip
    ?? "unknown";
  const key = `auth:${ip}`;
  const LIMIT = 10;
  const WINDOW_MS = 15 * 60_000;

  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    windows.set(key, { count: 1, windowStart: now });
    next();
    return;
  }

  existing.count++;
  const resetInMs = WINDOW_MS - (now - existing.windowStart);

  if (existing.count > LIMIT) {
    logger.warn({ ip, count: existing.count }, '[RateLimit] Auth brute-force blocked');
    res.status(429).json({
      ok: false,
      error: 'Too many authentication attempts. Please wait before retrying.',
      code: 'AUTH_RATE_LIMIT',
      details: { retryAfterSeconds: Math.ceil(resetInMs / 1000) },
    });
    return;
  }

  next();
}

// ── Per-site behavioral ingestion rate limiter ────────────────────────────────
//
// Applied to public ingestion endpoints (no org context available).
// Two keys per check:
//   1. "behavioral:site:<siteUrl>"  — caps overall ingestion volume per site
//   2. "behavioral:ip:<ip>"         — caps token-harvest attempts per client IP
//
// Limits are intentionally strict to reduce the residual poisoning surface even
// when an attacker holds a valid session token.
//
const BEHAVIORAL_SITE_LIMITS: Record<string, { limitPerMin: number }> = {
  token:   { limitPerMin: 30  },  // token exchange — 30 new sessions/min/site
  event:   { limitPerMin: 600 },  // analytics events (generous for real traffic)
  session: { limitPerMin: 60  },  // session upserts
};

const BEHAVIORAL_IP_TOKEN_LIMIT = parseInt(process.env["BEHAVIORAL_IP_TOKEN_LIMIT"] ?? "20"); // token requests per IP per minute (env-overridable for tests)

export function behavioralRateLimit(
  endpoint: keyof typeof BEHAVIORAL_SITE_LIMITS,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Extract siteUrl from body (already parsed by this point)
    const siteUrl: string =
      (req.body?.siteKey as string | undefined) ??
      (req.body?.siteUrl as string | undefined) ??
      "unknown";

    const { limitPerMin } = BEHAVIORAL_SITE_LIMITS[endpoint];
    const siteKey = `behavioral:site:${endpoint}:${siteUrl}`;
    const { allowed: siteOk, resetInMs } = checkRate(siteKey, limitPerMin);

    if (!siteOk) {
      res.status(429).json({
        ok: false,
        error: "Ingestion rate limit exceeded for this site",
        code: "BEHAVIORAL_RATE_LIMIT",
        details: { retryAfterSeconds: Math.ceil(resetInMs / 1000) },
      });
      return;
    }

    // For the token exchange endpoint also enforce a per-IP limit to deter
    // token harvesting from a single source.
    if (endpoint === "token") {
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        req.ip ??
        "unknown";
      const ipKey = `behavioral:ip:token:${ip}`;
      const { allowed: ipOk, resetInMs: ipReset } = checkRate(
        ipKey,
        BEHAVIORAL_IP_TOKEN_LIMIT,
      );
      if (!ipOk) {
        logger.warn({ ip, siteUrl }, "[RateLimit] Behavioral token IP limit exceeded");
        res.status(429).json({
          ok: false,
          error: "Too many token requests from this IP",
          code: "BEHAVIORAL_IP_RATE_LIMIT",
          details: { retryAfterSeconds: Math.ceil(ipReset / 1000) },
        });
        return;
      }
    }

    next();
  };
}

export function getRateLimiterStats(): { windowCount: number } {
  return { windowCount: windows.size };
}
