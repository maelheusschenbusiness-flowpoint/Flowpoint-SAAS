import { Router, type IRouter } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { pool } from "@workspace/db";
import { cache } from "../lib/cache.js";
import { getCronStatus } from "../workers/cron-scheduler.js";
import { getRateLimiterStats } from "../middlewares/rateLimiter.js";
import { getPlanConfig } from "../lib/config.js";
import { store } from "../services/store.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: Math.round(process.uptime()) });
});

// ── Upstream probe helper ─────────────────────────────────────────────────────
interface ProbeResult {
  status: "ok" | "degraded" | "down";
  latencyMs: number;
  httpStatus?: number;
  detail: string;
}

async function probeUrl(
  url: string,
  options: RequestInit,
  timeoutMs = 3000,
  isOkStatus: (s: number) => boolean = s => s >= 200 && s < 300
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - t0;
    const ok = isOkStatus(resp.status);
    return {
      status: ok ? "ok" : "down",
      latencyMs,
      httpStatus: resp.status,
      detail: ok ? `HTTP ${resp.status} in ${latencyMs}ms` : `HTTP ${resp.status} — unexpected status`,
    };
  } catch (err: unknown) {
    return {
      status: "down",
      latencyMs: Date.now() - t0,
      detail: String((err as Error).message ?? err),
    };
  }
}

router.get("/healthz/deep", async (_req, res) => {
  const checks: Record<string, ProbeResult | { status: "ok" | "degraded" | "down"; latencyMs?: number; detail: string }> = {};
  const start = Date.now();

  // ── Database — real query, 3 s timeout ───────────────────────────────────
  const dbStart = Date.now();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 3000ms")), 3000)),
    ]);
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart, detail: "SELECT 1 succeeded" };
  } catch (err) {
    checks.database = { status: "down", latencyMs: Date.now() - dbStart, detail: safeErrMsg(err) };
  }

  // ── Stripe — live /v1/balance probe ──────────────────────────────────────
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  if (stripeKey) {
    checks.stripe = await probeUrl(
      "https://api.stripe.com/v1/balance",
      { headers: { Authorization: `Bearer ${stripeKey}` } },
      3000,
      s => s === 200  // 401 = invalid key → "down"
    );
    if (checks.stripe.httpStatus === 401) checks.stripe.detail = "HTTP 401 — invalid Stripe secret key";
  } else {
    checks.stripe = { status: "degraded", latencyMs: 0, detail: "STRIPE_SECRET_KEY not set — checkout disabled in production" };
  }

  // ── OpenAI — live /v1/models probe ───────────────────────────────────────
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey) {
    checks.openai = await probeUrl(
      "https://api.openai.com/v1/models?limit=1",
      { headers: { Authorization: `Bearer ${openaiKey}` } },
      3000
    );
  } else {
    checks.openai = { status: "degraded", latencyMs: 0, detail: "OPENAI_API_KEY not set — AI features disabled" };
  }

  // ── BetterStack — live /api/v2/monitors probe ─────────────────────────────
  const bsToken = process.env["BETTERSTACK_API_TOKEN"];
  if (bsToken) {
    checks.betterstack = await probeUrl(
      "https://uptime.betterstack.com/api/v2/monitors?per_page=1",
      { headers: { Authorization: `Bearer ${bsToken}` } },
      3000
    );
  } else {
    checks.betterstack = { status: "degraded", latencyMs: 0, detail: "BETTERSTACK_API_TOKEN not set — uptime sync disabled" };
  }

  // ── DataForSEO — live tasks_ready probe (Basic auth) ─────────────────────
  const dfsLogin = process.env["DATAFORSEO_LOGIN"];
  const dfsPass  = process.env["DATAFORSEO_PASSWORD"];
  if (dfsLogin && dfsPass) {
    const basicAuth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString("base64");
    checks.dataforseo = await probeUrl(
      "https://api.dataforseo.com/v3/serp/google/organic/tasks_ready",
      { headers: { Authorization: `Basic ${basicAuth}` } },
      3000,
      s => s >= 200 && s < 300
    );
  } else {
    checks.dataforseo = { status: "degraded", latencyMs: 0, detail: "DATAFORSEO_LOGIN/PASSWORD not set — SERP & keyword data unavailable" };
  }

  // ── Resend — live /domains probe ─────────────────────────────────────────
  const resendKey = process.env["RESEND_API_KEY"];
  if (resendKey) {
    checks.resend = await probeUrl(
      "https://api.resend.com/domains",
      { headers: { Authorization: `Bearer ${resendKey}` } },
      3000
    );
  } else {
    checks.resend = { status: "degraded", latencyMs: 0, detail: "RESEND_API_KEY not set — transactional emails disabled" };
  }

  // ── Google OAuth — env presence + public reachability probe ──────────────
  const googleClientId     = process.env["GOOGLE_CLIENT_ID"];
  const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (googleClientId && googleClientSecret) {
    // Probe Google's OIDC discovery doc (public, always 200) to confirm reachability
    const reachability = await probeUrl(
      "https://accounts.google.com/.well-known/openid-configuration",
      {},
      3000
    );
    checks.google_oauth = {
      ...reachability,
      detail: reachability.status === "ok"
        ? `OAuth credentials configured — Google APIs reachable (${reachability.latencyMs}ms)`
        : `OAuth credentials configured but Google unreachable: ${reachability.detail}`,
    };
  } else {
    checks.google_oauth = { status: "degraded", latencyMs: 0, detail: "GOOGLE_CLIENT_ID/SECRET not set — GSC, GA4, GBP integrations unavailable" };
  }

  // ── Cache ─────────────────────────────────────────────────────────────────
  const cacheStats = cache.getStats();
  checks.cache = { status: "ok", latencyMs: 0, detail: `${cacheStats.size} entries, ${cacheStats.hitRate} hit rate` };

  const hasDown    = Object.values(checks).some(c => c.status === "down");
  const hasDegraded = Object.values(checks).some(c => c.status === "degraded");
  const plan = store.me?.plan ?? "standard";
  const planConfig = getPlanConfig(plan);

  res.status(hasDown ? 503 : 200).json({
    status: hasDown ? "down" : hasDegraded ? "degraded" : "ok",
    uptime: Math.round(process.uptime()),
    latencyMs: Date.now() - start,
    checks,
    plan: {
      current: plan,
      quotas: planConfig.quotas,
      features: Object.entries(planConfig.features).filter(([, v]) => v).map(([k]) => k),
    },
    rateLimit: getRateLimiterStats(),
    crons: getCronStatus(),
    version: process.env["npm_package_version"] ?? "2.0.0",
    environment: process.env["NODE_ENV"] ?? "development",
    timestamp: new Date().toISOString(),
  });
});

export default router;
