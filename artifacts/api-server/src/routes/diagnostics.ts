import { Router } from "express";
import { pool, db, auditsTable, monitorsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getCronStatus } from "../workers/cron-scheduler.js";
import { store } from "../services/store.js";

const router = Router();

// ── Shared probe helper ───────────────────────────────────────────────────────
interface ProbeResult {
  status: "connected" | "error" | "setup_required";
  latencyMs: number;
  httpStatus?: number;
  detail: string;
  liveProbe: boolean;
}

async function probeApi(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 3000,
  isOk: (s: number) => boolean = s => s >= 200 && s < 300
): Promise<{ ok: boolean; latencyMs: number; httpStatus: number | null; detail: string }> {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - t0;
    return {
      ok: isOk(resp.status),
      latencyMs,
      httpStatus: resp.status,
      detail: `HTTP ${resp.status}`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      httpStatus: null,
      detail: String((err as Error).message ?? err),
    };
  }
}

// ── Main diagnostics aggregate ────────────────────────────────────────────────
router.get("/diagnostics", async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string; ms?: number }> = {};
  const t = (start: number) => Date.now() - start;

  // Database connectivity
  const dbStart = Date.now();
  try {
    const r = await pool.query<{ now: string }>("SELECT NOW() AS now");
    checks["database"] = { ok: true, detail: `Connected · ${r.rows[0]?.now}`, ms: t(dbStart) };
  } catch (err: unknown) {
    checks["database"] = { ok: false, detail: String((err as Error).message), ms: t(dbStart) };
  }

  // Audits table
  const auditStart = Date.now();
  try {
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      avgScore: sql<number>`round(avg(score))::int`,
    }).from(auditsTable);
    checks["audits_table"] = { ok: true, detail: `${row?.total ?? 0} audits · avg score ${row?.avgScore ?? 0}`, ms: t(auditStart) };
  } catch (err: unknown) {
    checks["audits_table"] = { ok: false, detail: String((err as Error).message), ms: t(auditStart) };
  }

  // Monitors table
  const monitStart = Date.now();
  try {
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      down: sql<number>`count(*) filter (where status='down')::int`,
    }).from(monitorsTable);
    checks["monitors_table"] = { ok: true, detail: `${row?.total ?? 0} monitors · ${row?.down ?? 0} down`, ms: t(monitStart) };
  } catch (err: unknown) {
    checks["monitors_table"] = { ok: false, detail: String((err as Error).message), ms: t(monitStart) };
  }

  // Schema — table count + index count
  const cwtStart = Date.now();
  let indexCount = 0;
  try {
    const [tableRes, indexRes] = await Promise.all([
      pool.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      ),
      pool.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM pg_indexes WHERE schemaname = 'public'`
      ),
    ]);
    indexCount = indexRes.rows[0]?.cnt ?? 0;
    checks["schema"] = {
      ok: true,
      detail: `${tableRes.rows[0]?.cnt ?? 0} public tables · ${indexCount} indexes`,
      ms: t(cwtStart),
    };
  } catch (err: unknown) {
    checks["schema"] = { ok: false, detail: String((err as Error).message), ms: t(cwtStart) };
  }

  // Session store (PostgreSQL-backed)
  const sessStart = Date.now();
  let activeSessions = 0;
  try {
    const r = await pool.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM sessions WHERE expires_at > $1`, [Date.now()]
    );
    activeSessions = r.rows[0]?.cnt ?? 0;
    checks["session_store"] = { ok: true, detail: `${activeSessions} active sessions (PostgreSQL)`, ms: t(sessStart) };
  } catch (err: unknown) {
    checks["session_store"] = { ok: false, detail: String((err as Error).message), ms: t(sessStart) };
  }

  // Live BetterStack API check
  const bsStart = Date.now();
  if (process.env["BETTERSTACK_API_TOKEN"]) {
    try {
      const resp = await fetch("https://uptime.betterstack.com/api/v2/monitors?per_page=1", {
        headers: { Authorization: `Bearer ${process.env["BETTERSTACK_API_TOKEN"]}` },
        signal: AbortSignal.timeout(3000),
      });
      checks["betterstack_api"] = { ok: resp.ok, detail: `HTTP ${resp.status}`, ms: t(bsStart) };
    } catch (err: unknown) {
      checks["betterstack_api"] = { ok: false, detail: String((err as Error).message), ms: t(bsStart) };
    }
  }

  // ── Dedicated environment variable inventory ───────────────────────────────
  const ENV_VARS: Record<string, string | undefined> = {
    OPENAI_API_KEY:               process.env["OPENAI_API_KEY"],
    STRIPE_SECRET_KEY:            process.env["STRIPE_SECRET_KEY"],
    STRIPE_WEBHOOK_SECRET:        process.env["STRIPE_WEBHOOK_SECRET"],
    STRIPE_WEBHOOK_SECRET_RENDER: process.env["STRIPE_WEBHOOK_SECRET_RENDER"],
    BETTERSTACK_API_TOKEN:        process.env["BETTERSTACK_API_TOKEN"],
    RESEND_API_KEY:               process.env["RESEND_API_KEY"],
    DATAFORSEO_LOGIN:             process.env["DATAFORSEO_LOGIN"],
    DATAFORSEO_PASSWORD:          process.env["DATAFORSEO_PASSWORD"],
    GOOGLE_CLIENT_ID:             process.env["GOOGLE_CLIENT_ID"],
    GOOGLE_CLIENT_SECRET:         process.env["GOOGLE_CLIENT_SECRET"],
    GITHUB_CLIENT_ID:             process.env["GITHUB_CLIENT_ID"],
    GITHUB_CLIENT_SECRET:         process.env["GITHUB_CLIENT_SECRET"],
    JWT_SECRET:                   process.env["JWT_SECRET"],
    MONGO_URI:                    process.env["MONGO_URI"],
    SUPABASE_URL:                 process.env["SUPABASE_URL"],
    SUPABASE_SERVICE_ROLE_KEY:    process.env["SUPABASE_SERVICE_ROLE_KEY"],
    ADMIN_KEY:                    process.env["ADMIN_KEY"],
    CRON_KEY:                     process.env["CRON_KEY"],
    PUBLIC_STRIPE_API_KEY:        process.env["PUBLIC_STRIPE_API_KEY"],
  };
  const envVars: Record<string, "set" | "not_set"> = {};
  for (const [k, v] of Object.entries(ENV_VARS)) {
    envVars[k] = v ? "set" : "not_set";
  }
  const envMissingCritical = (["JWT_SECRET", "STRIPE_SECRET_KEY", "OPENAI_API_KEY"] as const)
    .filter(k => envVars[k] === "not_set");

  // Worker / cron summary
  const cronStatus = getCronStatus();
  const cronJobs = cronStatus.jobs ?? [];
  const cronCount = cronStatus.totalJobs ?? cronJobs.length;
  const enabledCronCount = cronJobs.filter(w => w.status !== "disabled").length;

  const allOk = Object.values(checks).every(c => c.ok);
  const failCount = Object.values(checks).filter(c => !c.ok).length;

  logger.info({ failCount }, "[Diagnostics] Health check completed");

  res.status(allOk ? 200 : 207).json({
    ok: allOk,
    status: allOk ? "healthy" : "degraded",
    failCount,
    checks,
    // Aggregated summary
    cronCount,
    enabledCronCount,
    indexCount,
    activeSessions,
    sessionStoreType: "postgresql",
    plan: store.me.plan ?? "standard",
    // Dedicated env var inventory (present/absent only — values never exposed)
    envVars,
    envMissingCritical,
    environment: process.env["NODE_ENV"] ?? "development",
    demoMode: process.env["NODE_ENV"] !== "production" || process.env["PREVIEW_MODE"] === "true",
    uptime: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
  });
});

// ── Worker / cron status ─────────────────────────────────────────────────────
router.get("/diagnostics/workers", async (_req, res) => {
  const workers = getCronStatus();
  const now = Date.now();

  const [historyResult, failuresResult] = await Promise.allSettled([
    pool.query<{ job_name: string; status: string; duration_ms: number; error: string | null; ran_at: Date }>(
      `SELECT job_name, status, duration_ms, error, ran_at
         FROM cron_history ORDER BY ran_at DESC LIMIT 50`
    ),
    pool.query<{ worker_name: string; error: string; failed_at: Date }>(
      `SELECT worker_name, error, failed_at
         FROM worker_failures ORDER BY failed_at DESC LIMIT 20`
    ),
  ]);

  const recentRuns  = historyResult.status  === "fulfilled" ? historyResult.value.rows  : [];
  const recentFails = failuresResult.status === "fulfilled" ? failuresResult.value.rows : [];

  res.json({
    total:   workers.length,
    enabled: workers.filter(w => w.enabled).length,
    workers: workers.map(w => ({
      name:        w.name,
      schedule:    w.schedule,
      enabled:     w.enabled,
      lastRun:     w.lastRun ? new Date(w.lastRun).toISOString() : null,
      lastRunAgoS: w.lastRun ? Math.round((now - w.lastRun) / 1000) : null,
    })),
    recentRuns:   recentRuns.map(r => ({
      job:        r.job_name,
      status:     r.status,
      durationMs: r.duration_ms,
      error:      r.error ?? null,
      ranAt:      r.ran_at,
    })),
    recentFailures: recentFails.map(f => ({
      worker:   f.worker_name,
      error:    f.error,
      failedAt: f.failed_at,
    })),
    checkedAt: new Date().toISOString(),
  });
});

// ── Integration status — real probes where possible ───────────────────────────
//
// Strategy:
//  - API-key services (Stripe, OpenAI, DataForSEO, BetterStack, Resend):
//      make a real HTTP call (3s timeout) → "connected" | "error"
//  - OAuth-based services (GSC, GA4, GBP, GitHub, Slack, HubSpot):
//      check connectors table for an active row (contains user tokens);
//      if absent, check env vars for OAuth app credentials.
//      Live probe not applicable without per-user tokens.
//
router.get("/diagnostics/integrations", async (_req, res) => {
  // Fetch all connector rows once
  type ConnRow = { provider: string; status: string; org_id: string };
  let connectorRows: ConnRow[] = [];
  try {
    const r = await pool.query<ConnRow>(
      `SELECT provider, status, org_id FROM connectors ORDER BY provider`
    );
    connectorRows = r.rows;
  } catch { /* connectors table may not exist in older deploys */ }

  function findConnector(aliases: string[]): ConnRow | undefined {
    return connectorRows.find(row =>
      aliases.includes(row.provider.toLowerCase().replace(/-/g, "_"))
    );
  }

  function connectorStatus(row: ConnRow): "connected" | "setup_required" | "error" {
    const s = row.status.toLowerCase();
    if (s === "active" || s === "connected") return "connected";
    if (s === "error" || s === "failed")     return "error";
    return "setup_required";
  }

  const integrations: ProbeResult[] = [];

  // ── Stripe (API key → live probe) ─────────────────────────────────────────
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (stripeKey) {
    const p = await probeApi(
      "https://api.stripe.com/v1/balance",
      { Authorization: `Bearer ${stripeKey}` },
      3000,
      s => s === 200
    );
    integrations.push({
      name: "stripe",
      status: p.ok ? "connected" : "error",
      latencyMs: p.latencyMs,
      httpStatus: p.httpStatus ?? undefined,
      detail: p.ok ? `Balance endpoint returned ${p.detail}` : `Stripe API error: ${p.detail}`,
      liveProbe: true,
    } as ProbeResult & { name: string });
  } else {
    integrations.push({ name: "stripe", status: "setup_required", latencyMs: 0, detail: "STRIPE_SECRET_KEY not configured", liveProbe: false } as ProbeResult & { name: string });
  }

  // ── OpenAI (API key → live probe) ─────────────────────────────────────────
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (openaiKey) {
    const p = await probeApi(
      "https://api.openai.com/v1/models?limit=1",
      { Authorization: `Bearer ${openaiKey}` },
      3000
    );
    integrations.push({
      name: "openai",
      status: p.ok ? "connected" : "error",
      latencyMs: p.latencyMs,
      httpStatus: p.httpStatus ?? undefined,
      detail: p.ok ? `Models endpoint OK (${p.detail})` : `OpenAI API error: ${p.detail}`,
      liveProbe: true,
    } as ProbeResult & { name: string });
  } else {
    integrations.push({ name: "openai", status: "setup_required", latencyMs: 0, detail: "OPENAI_API_KEY not configured", liveProbe: false } as ProbeResult & { name: string });
  }

  // ── DataForSEO (Basic auth → live probe) ──────────────────────────────────
  const dfsLogin = process.env["DATAFORSEO_LOGIN"];
  const dfsPass  = process.env["DATAFORSEO_PASSWORD"];
  if (dfsLogin && dfsPass) {
    const basic = Buffer.from(`${dfsLogin}:${dfsPass}`).toString("base64");
    const p = await probeApi(
      "https://api.dataforseo.com/v3/serp/google/organic/tasks_ready",
      { Authorization: `Basic ${basic}` },
      3000,
      s => s >= 200 && s < 300
    );
    integrations.push({
      name: "dataforseo",
      status: p.ok ? "connected" : "error",
      latencyMs: p.latencyMs,
      httpStatus: p.httpStatus ?? undefined,
      detail: p.ok ? `Tasks ready endpoint OK (${p.detail})` : `DataForSEO error: ${p.detail}`,
      liveProbe: true,
    } as ProbeResult & { name: string });
  } else {
    integrations.push({ name: "dataforseo", status: "setup_required", latencyMs: 0, detail: "DATAFORSEO_LOGIN/PASSWORD not configured", liveProbe: false } as ProbeResult & { name: string });
  }

  // ── BetterStack (Bearer token → live probe) ────────────────────────────────
  const bsToken = process.env["BETTERSTACK_API_TOKEN"];
  if (bsToken) {
    const p = await probeApi(
      "https://uptime.betterstack.com/api/v2/monitors?per_page=1",
      { Authorization: `Bearer ${bsToken}` },
      3000
    );
    integrations.push({
      name: "betterstack",
      status: p.ok ? "connected" : "error",
      latencyMs: p.latencyMs,
      httpStatus: p.httpStatus ?? undefined,
      detail: p.ok ? `Monitors endpoint OK (${p.detail})` : `BetterStack error: ${p.detail}`,
      liveProbe: true,
    } as ProbeResult & { name: string });
  } else {
    integrations.push({ name: "betterstack", status: "setup_required", latencyMs: 0, detail: "BETTERSTACK_API_TOKEN not configured", liveProbe: false } as ProbeResult & { name: string });
  }

  // ── Resend (Bearer → live probe) ──────────────────────────────────────────
  const resendKey = process.env["RESEND_API_KEY"];
  if (resendKey) {
    const p = await probeApi(
      "https://api.resend.com/domains",
      { Authorization: `Bearer ${resendKey}` },
      3000
    );
    integrations.push({
      name: "resend",
      status: p.ok ? "connected" : "error",
      latencyMs: p.latencyMs,
      httpStatus: p.httpStatus ?? undefined,
      detail: p.ok ? `Domains endpoint OK (${p.detail})` : `Resend error: ${p.detail}`,
      liveProbe: true,
    } as ProbeResult & { name: string });
  } else {
    integrations.push({ name: "resend", status: "setup_required", latencyMs: 0, detail: "RESEND_API_KEY not configured", liveProbe: false } as ProbeResult & { name: string });
  }

  // ── OAuth-based integrations — connector table + env var check ────────────
  // Live API probe not applicable without per-user access tokens.
  // Status derived from connector rows (which hold user tokens) + env var presence.

  const OAUTH_INTEGRATIONS: Array<{ name: string; aliases: string[]; envOk: boolean; envDetail: string }> = [
    {
      name: "google_oauth",
      aliases: ["google", "google_oauth"],
      envOk: !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]),
      envDetail: "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET",
    },
    {
      name: "gsc",
      aliases: ["gsc", "google_search_console"],
      envOk: !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]),
      envDetail: "Google Search Console (requires Google OAuth credentials)",
    },
    {
      name: "ga4",
      aliases: ["ga4", "google_analytics", "google_analytics_4"],
      envOk: !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]),
      envDetail: "Google Analytics 4 (requires Google OAuth credentials)",
    },
    {
      name: "gbp",
      aliases: ["gbp", "google_business_profile", "google_my_business"],
      envOk: !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]),
      envDetail: "Google Business Profile (requires Google OAuth credentials)",
    },
    {
      name: "github",
      aliases: ["github"],
      envOk: !!(process.env["GITHUB_CLIENT_ID"] && process.env["GITHUB_CLIENT_SECRET"]),
      envDetail: "GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET",
    },
    {
      name: "slack",
      aliases: ["slack"],
      envOk: !!process.env["SLACK_BOT_TOKEN"],
      envDetail: "SLACK_BOT_TOKEN",
    },
    {
      name: "hubspot",
      aliases: ["hubspot"],
      envOk: !!process.env["HUBSPOT_API_KEY"],
      envDetail: "HUBSPOT_API_KEY",
    },
  ];

  for (const def of OAUTH_INTEGRATIONS) {
    const row = findConnector(def.aliases);
    if (row) {
      const cs = connectorStatus(row);
      integrations.push({
        name: def.name,
        status: cs,
        latencyMs: 0,
        detail: cs === "connected"
          ? `Active connector found (provider: ${row.provider})`
          : `Connector present but status is '${row.status}'`,
        liveProbe: false,
        note: "Live API probe not available for OAuth-based integrations (requires per-user access token)",
      } as ProbeResult & { name: string; note?: string });
    } else if (def.envOk) {
      integrations.push({
        name: def.name,
        status: "setup_required",
        latencyMs: 0,
        detail: `${def.envDetail} configured — user has not yet completed OAuth flow`,
        liveProbe: false,
        note: "Credentials configured; user must connect via the UI to generate access tokens",
      } as ProbeResult & { name: string; note?: string });
    } else {
      integrations.push({
        name: def.name,
        status: "setup_required",
        latencyMs: 0,
        detail: `${def.envDetail} not configured`,
        liveProbe: false,
      } as ProbeResult & { name: string });
    }
  }

  const connected     = integrations.filter(i => i.status === "connected").length;
  const setupRequired = integrations.filter(i => i.status === "setup_required").length;
  const errored       = integrations.filter(i => i.status === "error").length;

  res.json({
    summary: { connected, setup_required: setupRequired, error: errored },
    integrations,
    checkedAt: new Date().toISOString(),
  });
});

// ── Billing / Stripe status ───────────────────────────────────────────────────
router.get("/diagnostics/billing", async (_req, res) => {
  const stripeKeyPresent     = !!(process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"]);
  const webhookSecretPresent = !!process.env["STRIPE_WEBHOOK_SECRET"];
  const webhookRenderPresent = !!process.env["STRIPE_WEBHOOK_SECRET_RENDER"];

  // Last billing event from DB
  let lastBillingEvent: { type: string; createdAt: Date } | null = null;
  try {
    const r = await pool.query<{ type: string; created_at: Date }>(
      `SELECT type, created_at FROM billing_events ORDER BY created_at DESC LIMIT 1`
    );
    if (r.rows[0]) lastBillingEvent = { type: r.rows[0].type, createdAt: r.rows[0].created_at };
  } catch { /* table may not exist yet */ }

  // Live Stripe API ping — 200 = valid key; anything else = error
  let stripeApiStatus: "ok" | "error" | "not_configured" = "not_configured";
  let stripeApiLatencyMs: number | null = null;
  if (stripeKeyPresent) {
    const t0 = Date.now();
    try {
      const resp = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${process.env["STRIPE_SECRET_KEY"]}` },
        signal: AbortSignal.timeout(3000),
      });
      stripeApiLatencyMs = Date.now() - t0;
      stripeApiStatus = resp.ok ? "ok" : "error";
    } catch {
      stripeApiLatencyMs = Date.now() - t0;
      stripeApiStatus = "error";
    }
  }

  res.json({
    stripeKeyPresent,
    webhookSecretPresent,
    webhookRenderPresent,
    stripeApiStatus,
    stripeApiLatencyMs,
    lastBillingEvent,
    plan: store.me.plan ?? "standard",
    subscriptionStatus: store.me.subscriptionStatus ?? "unknown",
    stripeCustomerId: store.me.stripeCustomerId ? "set" : "not_set",
    checkedAt: new Date().toISOString(),
  });
});

// ── Database structural health ────────────────────────────────────────────────
router.get("/diagnostics/database", async (_req, res) => {
  const result: Record<string, unknown> = {};

  // Table count
  try {
    const r = await pool.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    result["tableCount"] = r.rows[0]?.cnt ?? 0;
  } catch { result["tableCount"] = null; }

  // Index count
  try {
    const r = await pool.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM pg_indexes WHERE schemaname = 'public'`
    );
    result["indexCount"] = r.rows[0]?.cnt ?? 0;
  } catch { result["indexCount"] = null; }

  // FK constraint count
  try {
    const r = await pool.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'`
    );
    result["fkCount"] = r.rows[0]?.cnt ?? 0;
  } catch { result["fkCount"] = null; }

  // Active sessions
  try {
    const r = await pool.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM sessions WHERE expires_at > $1`, [Date.now()]
    );
    result["activeSessions"] = r.rows[0]?.cnt ?? 0;
  } catch { result["activeSessions"] = null; }

  // Key table row counts
  const TABLE_COUNTS = [
    "audits", "monitors", "ai_monthly_usage", "ai_usage_logs",
    "cron_history", "worker_failures", "billing_events", "tracked_keywords",
  ];
  const counts: Record<string, number | null> = {};
  await Promise.allSettled(
    TABLE_COUNTS.map(async tbl => {
      try {
        const r = await pool.query<{ cnt: number }>(`SELECT count(*)::int AS cnt FROM ${tbl}`);
        counts[tbl] = r.rows[0]?.cnt ?? 0;
      } catch { counts[tbl] = null; }
    })
  );
  result["rowCounts"] = counts;

  // List all public tables with size
  try {
    const r = await pool.query<{ tablename: string; size: string }>(
      `SELECT tablename, pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS size
         FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    result["tables"] = r.rows;
  } catch { result["tables"] = []; }

  result["checkedAt"] = new Date().toISOString();
  res.json(result);
});

export default router;
