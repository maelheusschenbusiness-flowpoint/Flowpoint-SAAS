import { pool, withOrgDb, withOrgDbClient } from "@workspace/db";
import type { PoolClient } from "pg";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { loadOrgData } from "./org-data.js";
import { PLAN_AI_CREDITS, PLAN_AI_TOKENS } from "../lib/plans.js";
import { loadOrgAIPrefs, resolveAIModel } from "./ai-prefs.js";
import {
  getFeatureBaseCost,
  getModelConfig,
  getModelMultiplier,
  computeRealCostEur,
  computeCreditsDebited,
  CREDIT_EUR_RATE,
  type AIProviderId,
} from "../config/ai-config.js";

/** All supported models — openai, anthropic, gemini only */
export type AIModel =
  | "gpt-5" | "gpt-5-mini" | "gpt-5-nano" | "gpt-5.4" | "gpt-5.3-codex" | "gpt-5.2"
  | "gpt-image-1" | "gpt-4o" | "gpt-4o-mini" | "o3" | "o4-mini"
  | "claude-sonnet-4-6" | "claude-sonnet-4-5" | "claude-opus-4-8" | "claude-opus-4-7" | "claude-haiku-4-5"
  | "gemini-3.1-pro-preview" | "gemini-3-flash-preview" | "gemini-3.5-flash"
  | "gemini-3-pro-image-preview" | "gemini-3.1-flash-image" | "gemini-2.5-flash-image";

export type AIFeature =
  | "chat"
  | "strategist"
  | "report_gen"
  | "mission_auto"
  | "cro_analysis"
  | "forecast"
  | "market_intel"
  | "behavior_analysis"
  | "revenue_leak"
  | "audit_summary"
  | "overview_insights";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** In-process cache of legacy orgId → canonical organizations.id (UUID). */
const _canonOrgCache = new Map<string, string | null>();

/**
 * Resolve a possibly-legacy org identifier (email-shaped or `org_...`) to the
 * canonical organizations.id UUID. ai_usage_logs / ai_monthly_usage have
 * UUID org_id columns, so any non-UUID id would make PostgreSQL reject the
 * write (`invalid input syntax for type uuid`) and silently lose the usage.
 * Returns null when no canonical org can be found.
 */
export async function resolveCanonicalOrgUuid(orgId: string): Promise<string | null> {
  if (UUID_RE.test(orgId)) return orgId;
  if (_canonOrgCache.has(orgId)) return _canonOrgCache.get(orgId) ?? null;
  let resolved: string | null = null;
  try {
    const client = await pool.connect();
    try {
      // Legacy ids are usually the owner's email (checkout metadata) — same
      // canonicalization rule as the Stripe webhook.
      const r = await client.query<{ id: string }>(
        `SELECT id FROM organizations
          WHERE lower(owner_email) = lower($1)
          ORDER BY created_at DESC LIMIT 1`,
        [orgId]
      );
      resolved = r.rows[0]?.id ? String(r.rows[0].id) : null;
    } finally { client.release(); }
  } catch (err) {
    // Transient persistence failure — this is NOT a verified absence. Callers
    // must treat it as "quota state unavailable" (503), never as a 402
    // unresolvable-org verdict. Do not cache.
    logger.warn({ err, orgId }, "[AI] resolveCanonicalOrgUuid lookup failed");
    const e = new Error(`org canonicalization lookup unavailable: ${orgId}`);
    (e as Error & { code?: string }).code = "ORG_LOOKUP_UNAVAILABLE";
    throw e;
  }
  _canonOrgCache.set(orgId, resolved);
  if (!resolved) logger.error({ orgId }, "[AI] no canonical org UUID found for legacy orgId — usage cannot be tracked");
  return resolved;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthResetDate(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function planCreditLimit(plan?: string | null): number {
  return PLAN_AI_CREDITS[(plan ?? "standard").toLowerCase()] ?? PLAN_AI_CREDITS.standard;
}

export async function getOrCreateMonthlyUsage(rawOrgId = "default"): Promise<{
  creditsUsed: number;
  creditsLimit: number;
  creditsExtra: number;
  costEur: number;
  requestCount: number;
  tokensUsed: number;
  tokenLimit: number;
  resetAt: Date;
}> {
  const month       = currentMonth();
  // Canonicalize legacy org ids (email / org_...) BEFORE any quota read/write.
  // The AI tables have UUID org_id — a raw legacy id used to throw here, which
  // checkAIQuota() caught and turned into an unlimited "degraded" allow, i.e.
  // legacy accounts bypassed the quota gate entirely.
  const orgId = await resolveCanonicalOrgUuid(rawOrgId);
  if (!orgId) {
    const e = new Error(`AI usage org id not canonicalizable: ${rawOrgId}`);
    (e as Error & { code?: string }).code = "ORG_NOT_CANONICAL";
    throw e;
  }
  const _dbData     = await loadOrgData(orgId).catch(() => null);
  const plan        = (_dbData?.plan || store.me.plan || "standard").toLowerCase();
  const creditLimit = planCreditLimit(plan);
  const tokenLimit  = PLAN_AI_TOKENS[plan] ?? PLAN_AI_TOKENS.standard;

  type RowT   = { credits_used: number; cost_eur: number; request_count: number; tokens_used: number; };
  type ExtraT = { extra: number };
  type ResultT = [RowT | null, number];

  const result = await withOrgDb<ResultT>(orgId, async (client) => {
    // Fetch monthly usage AND purchased extra credits in one round-trip.
    // Canonical extra-credit source: ai_credit_purchases (Stripe webhook appends rows there).
    const [usageRes, extraRes] = await Promise.all([
      client.query<RowT>(
        `SELECT credits_used, cost_eur, request_count, COALESCE(tokens_used, 0) AS tokens_used
         FROM ai_monthly_usage WHERE org_id = $1 AND month = $2 LIMIT 1`,
        [orgId, month]
      ),
      client.query<ExtraT>(
        `SELECT COALESCE(SUM(credits), 0)::integer AS extra FROM ai_credit_purchases WHERE org_id = $1`,
        [orgId]
      ),
    ]);
    const creditsExtra = Number(extraRes.rows[0]?.extra ?? 0);

    if (usageRes.rows[0]) return [usageRes.rows[0], creditsExtra];

    await client.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,0,0,0,0,$4,NOW())
       ON CONFLICT (org_id, month) DO NOTHING`,
      [`amu_${orgId}_${month}`, orgId, month, monthResetDate()]
    );
    return [null, creditsExtra];
  });

  const [row, creditsExtra] = Array.isArray(result) ? result : [null, 0];

  if (row) {
    return {
      creditsUsed:  Number(row.credits_used),
      creditsLimit: creditLimit,
      creditsExtra,
      costEur:      Number(row.cost_eur),
      requestCount: Number(row.request_count),
      tokensUsed:   Number(row.tokens_used),
      tokenLimit,
      resetAt:      monthResetDate(),
    };
  }

  return {
    creditsUsed: 0, creditsLimit: creditLimit, creditsExtra, costEur: 0,
    requestCount: 0, tokensUsed: 0, tokenLimit, resetAt: monthResetDate(),
  };
}

export async function consumeAICredits(opts: {
  feature: AIFeature;
  orgId?: string;
  userId?: string;
  model?: AIModel;
  provider?: AIProviderId;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  metadata?: Record<string, unknown>;
  /** Idempotency key — reuse on retry to avoid double-billing. */
  requestId?: string;
}): Promise<{ allowed: boolean; creditsUsed: number; remaining: number }> {
  const rawOrgId    = opts.orgId ?? "default";
  // Canonicalize BEFORE any read/write — fail CLOSED when unresolvable:
  // an org whose usage cannot be tracked must not receive provider-backed work.
  const orgId = await resolveCanonicalOrgUuid(rawOrgId);
  if (!orgId) {
    logger.error({ rawOrgId, feature: opts.feature }, "[AI] consumeAICredits — org id not canonicalizable, blocking request");
    return { allowed: false, creditsUsed: 0, remaining: 0 };
  }
  const aiCfg       = opts.model ? null : await (async () => {
    try {
      const { selectOptimalModel } = await import("./ai-prefs.js");
      return await selectOptimalModel(opts.feature, orgId);
    } catch { return null; }
  })();
  const model       = opts.model ?? (aiCfg?.model || "gpt-5-mini");
  const provider    = opts.provider ?? aiCfg?.provider ?? "openai";
  const tokensIn    = opts.tokensIn  ?? 800;
  const tokensOut   = opts.tokensOut ?? 400;
  const cachedTokens= opts.cachedTokens ?? 0;

  // ── Dynamic cost calculation ──────────────────────────────────────────────────────────────
  const realCostEur    = computeRealCostEur({ model, tokensIn, tokensOut, cachedTokens });
  const creditsDebited = computeCreditsDebited({ feature: opts.feature, model, realCostEur });

  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const remaining = Math.max(0, totalAvailable - usage.creditsUsed);

    if (usage.creditsUsed + creditsDebited > totalAvailable * 1.05) {
      logger.warn({ feature: opts.feature, orgId, creditsDebited }, "[AI] Credits exhausted — blocking request");
      await triggerAIAlert(orgId, "quota_100pct", usage.creditsUsed, totalAvailable);
      return { allowed: false, creditsUsed: 0, remaining };
    }

    // ── Debit through the single atomic + idempotent write path ────────────
    // (log + monthly aggregate in one transaction, threshold alerts included)
    const rec = await recordCompletedUsage({
      feature: opts.feature, orgId, userId: opts.userId ?? "system",
      model: model as AIModel, provider, tokensIn, tokensOut, cachedTokens,
      latencyMs: 0, success: true,
      requestId: opts.requestId,
      metadata: opts.metadata,
      fixedCreditCost: creditsDebited,
    });

    return { allowed: true, creditsUsed: rec.creditsDebited, remaining: rec.remaining };
  } catch (err) {
    if ((err as Error & { code?: string })?.code === "ORG_NOT_CANONICAL") {
      logger.error({ orgId, feature: opts.feature }, "[AI] consumeAICredits — org not canonicalizable, blocking request");
      return { allowed: false, creditsUsed: 0, remaining: 0 };
    }
    // Fail CLOSED: if the quota state cannot be read or the debit cannot be
    // persisted, provider-backed work must not proceed (billing risk).
    logger.error({ err, orgId, feature: opts.feature }, "[AI] consumeAICredits failed — blocking request (fail-closed)");
    return { allowed: false, creditsUsed: 0, remaining: 0 };
  }
}

/** Read-only quota precheck — no DB writes. Call this before the AI request.
 *  Only debit via consumeAICredits() after the AI call succeeds. */
export async function checkAIQuota(opts: {
  feature: AIFeature;
  orgId?: string;
}): Promise<{ allowed: boolean; remaining: number }> {
  const orgId = opts.orgId ?? "default";
  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const remaining = Math.max(0, totalAvailable - usage.creditsUsed);
    const estimatedCost = getFeatureBaseCost(opts.feature);
    if (usage.creditsUsed + estimatedCost > totalAvailable * 1.05) {
      logger.warn({ feature: opts.feature, orgId }, "[AI] checkAIQuota — quota exhausted, blocking request");
      await triggerAIAlert(orgId, "quota_100pct", usage.creditsUsed, totalAvailable);
      return { allowed: false, remaining };
    }
    return { allowed: true, remaining };
  } catch (err) {
    if ((err as Error & { code?: string })?.code === "ORG_NOT_CANONICAL") {
      // Fail CLOSED: an org whose usage cannot be read/written would otherwise
      // get unlimited untracked provider calls (direct billing risk).
      logger.error({ orgId }, "[AI] checkAIQuota — org id not canonicalizable, blocking request");
      return { allowed: false, remaining: 0 };
    }
    // Fail CLOSED for every persistence/read failure: when the quota state is
    // unreadable, allowing would grant unlimited untracked provider calls.
    logger.error({ err, orgId }, "[AI] checkAIQuota failed — blocking request (fail-closed)");
    return { allowed: false, remaining: 0 };
  }
}

export async function trackAIUsage(opts: {
  feature: AIFeature;
  orgId?: string;
  userId?: string;
  model: AIModel;
  provider?: AIProviderId;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  latencyMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // Thin wrapper over the single atomic + idempotent write path — canonical
  // org resolution, one transaction for log + monthly aggregate, loud errors.
  await recordCompletedUsage({
    feature: opts.feature,
    orgId: opts.orgId ?? "default",
    userId: opts.userId ?? "system",
    model: opts.model,
    provider: opts.provider,
    tokensIn: opts.tokensIn,
    tokensOut: opts.tokensOut,
    cachedTokens: opts.cachedTokens,
    latencyMs: opts.latencyMs,
    success: opts.success,
    metadata: opts.metadata,
  });
}

export async function recordCompletedUsage(opts: {
  feature: AIFeature;
  orgId: string;
  userId: string;
  model: AIModel;
  provider?: AIProviderId;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  latencyMs: number;
  success: boolean;
  /** Idempotency key — callers should generate once per logical AI request and reuse
   *  on retry. The key is stored in ai_usage_logs.idempotency_key with a UNIQUE index,
   *  so a second call with the same key is silently ignored (no double-billing). */
  requestId?: string;
  /** Economy metadata — requestedModel, effectiveModel, economyTier, etc. */
  metadata?: Record<string, unknown>;
  /** Override the computed credit cost. Use to enforce the feature base cost
   *  regardless of model multiplier (e.g. feature-priced endpoints). */
  fixedCreditCost?: number;
}, execution?: {
  /** Reuse an already-reserved pool session (for example while holding a
   * session-level advisory lock) without acquiring another connection. */
  client: PoolClient;
  /** Canonical UUID already established by authenticated org context. */
  canonicalOrgId: string;
}): Promise<{ creditsDebited: number; remaining: number }> {
  const { userId, model, feature, tokensIn, tokensOut, latencyMs } = opts;
  const provider    = opts.provider ?? "openai";
  const cachedTok   = opts.cachedTokens ?? 0;
  const realCostEur = computeRealCostEur({ model, tokensIn, tokensOut, cachedTokens: cachedTok });
  const creditsDeb  = opts.fixedCreditCost !== undefined
    ? opts.fixedCreditCost
    : computeCreditsDebited({ feature, model, realCostEur });
  const month       = currentMonth();
  const logId       = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const idemKey     = opts.requestId ?? null;
  const metaJson    = opts.metadata ? JSON.stringify(opts.metadata) : null;

  // ── Canonicalize legacy org ids (email / org_...) → organizations.id UUID.
  // ai_usage_logs.org_id and ai_monthly_usage.org_id are UUID columns; a
  // non-UUID id used to make both writes fail silently ("invalid input syntax
  // for type uuid") — the provider was billed but FlowPoint never counted it.
  const orgId = execution?.canonicalOrgId ?? await resolveCanonicalOrgUuid(opts.orgId);
  if (!orgId) {
    // Verified absence — fail explicitly; callers must never receive a
    // success-shaped debit for usage that was not persisted.
    logger.error({ rawOrgId: opts.orgId, feature, model, tokensIn, tokensOut },
      "[AI] recordCompletedUsage: usage NOT recorded — org id could not be canonicalized");
    const e = new Error(`AI usage org id not canonicalizable: ${opts.orgId}`);
    (e as Error & { code?: string }).code = "ORG_NOT_CANONICAL";
    throw e;
  }

  // ── Atomic + idempotent write: the usage log insert and the monthly
  // aggregate upsert run in ONE transaction (withOrgDb wraps BEGIN/COMMIT).
  // The monthly upsert only runs when the log row was actually inserted:
  // a replayed requestId hits the idempotency unique index, inserts nothing,
  // and therefore does NOT double-increment ai_monthly_usage. If either
  // statement fails, the whole transaction rolls back — the log and the
  // aggregate can never diverge.
  let recorded = false;
  try {
    const recordUsage = async (client: PoolClient) => {
      const ins = await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, provider, model, feature, credits_used, credits_debited,
            tokens_in, tokens_out, cached_tokens, cost_eur, real_cost_eur, latency_ms, duration_ms, success, metadata, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [logId, orgId, userId, provider, model, feature,
         creditsDeb, creditsDeb,
         tokensIn, tokensOut, cachedTok,
         realCostEur, realCostEur,
         latencyMs, latencyMs,
         opts.success ? "true" : "false",
         metaJson,
         idemKey]
      );
      if (ins.rowCount === 0) {
        // Duplicate requestId — already billed once; skip the aggregate.
        return false;
      }
      await client.query(
        `INSERT INTO ai_monthly_usage
           (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7,NOW())
         ON CONFLICT (org_id, month) DO UPDATE
           SET credits_used   = ai_monthly_usage.credits_used   + $4,
               cost_eur       = ai_monthly_usage.cost_eur       + $5,
               request_count  = ai_monthly_usage.request_count  + 1,
               tokens_used    = ai_monthly_usage.tokens_used    + $6,
               updated_at     = NOW()`,
        [`amu_${orgId}_${month}`, orgId, month, creditsDeb, realCostEur, tokensIn + tokensOut, monthResetDate()]
      );
      return true;
    };
    recorded = execution
      ? await withOrgDbClient(execution.client, orgId, recordUsage)
      : await withOrgDb(orgId, recordUsage);
  } catch (err) {
    // Loud, explicit failure — the provider WAS consumed but FlowPoint could
    // not persist the usage. This must never pass silently at debug level.
    logger.error({ err, orgId, feature, model, requestId: idemKey },
      "[AI] recordCompletedUsage: usage write FAILED — provider consumed but not tracked");
    // Propagate: callers must never mistake a rolled-back debit for a success.
    throw err;
  }
  if (!recorded && idemKey) {
    logger.info({ orgId, requestId: idemKey }, "[AI] recordCompletedUsage: duplicate requestId — usage already recorded, aggregate not re-incremented");
  }

  if (execution) {
    const usage = await withOrgDbClient(execution.client, orgId, async (client) => {
      const result = await client.query<{
        credits_used: number;
        credits_limit: number;
        credits_extra: number;
      }>(
        `SELECT credits_used, credits_limit, credits_extra
         FROM ai_monthly_usage
         WHERE org_id::text = $1 AND month = $2
         LIMIT 1`,
        [orgId, month],
      );
      return result.rows[0];
    });
    const totalAvailable = Number(usage?.credits_limit ?? 0) + Number(usage?.credits_extra ?? 0);
    return {
      creditsDebited: creditsDeb,
      remaining: Math.max(0, totalAvailable - Number(usage?.credits_used ?? 0)),
    };
  }

  // Fetch updated usage for alert thresholds + return value
  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const newUsed = usage.creditsUsed;
    const oldUsed = newUsed - creditsDeb;
    const pct    = totalAvailable > 0 ? Math.round((newUsed  / totalAvailable) * 100) : 0;
    const oldPct = totalAvailable > 0 ? Math.round((oldUsed  / totalAvailable) * 100) : 0;
    if      (pct >= 100 && oldPct < 100) await triggerAIAlert(orgId, "quota_100pct", newUsed, totalAvailable);
    else if (pct >= 90  && oldPct < 90)  await triggerAIAlert(orgId, "quota_90pct",  newUsed, totalAvailable);
    else if (pct >= 70  && oldPct < 70)  await triggerAIAlert(orgId, "quota_70pct",  newUsed, totalAvailable);
    const remaining = Math.max(0, totalAvailable - newUsed);
    return { creditsDebited: creditsDeb, remaining };
  } catch {
    return { creditsDebited: creditsDeb, remaining: 0 };
  }
}

/**
 * Fire-and-forget variant with a durable compensating mechanism.
 *
 * Some call sites (SSE streaming, endpoints that respond before accounting)
 * cannot await/propagate a recording failure — the response is already gone.
 * For those paths, a failed atomic write is retried with backoff using the
 * SAME idempotency key, so a late success can never double-bill. If no
 * requestId was supplied, one is generated here to make retries safe.
 */
export function recordCompletedUsageDeferred(
  opts: Parameters<typeof recordCompletedUsage>[0],
): void {
  const withKey = opts.requestId
    ? opts
    : { ...opts, requestId: `req_deferred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  recordCompletedUsage(withKey).catch(async (err) => {
    if ((err as Error & { code?: string })?.code === "ORG_NOT_CANONICAL") {
      // Verified absence — retrying cannot succeed; already error-logged.
      return;
    }
    // Durable compensation: persist the payload to the outbox so a worker can
    // replay it (idempotency key prevents double-billing) even across restarts.
    try {
      await enqueueAiUsageOutbox(withKey);
      logger.warn({ orgId: withKey.orgId, requestId: withKey.requestId },
        "[AI] recordCompletedUsageDeferred: write failed — payload persisted to outbox for durable retry");
    } catch (enqueueErr) {
      // Store fully unavailable — last resort in-process retry, then loud loss.
      logger.error({ err, enqueueErr, orgId: withKey.orgId, requestId: withKey.requestId },
        "[AI] recordCompletedUsageDeferred: outbox enqueue failed — scheduling last-resort in-process retry");
      const t = setTimeout(() => recordCompletedUsageDeferred(withKey), 60_000);
      (t as { unref?: () => void }).unref?.();
    }
  });
}

// ── Durable outbox for AI usage writes ────────────────────────────────────────
// Failed deferred accounting is persisted here and replayed by a worker; the
// idempotency key on ai_usage_logs makes replays safe (no double-billing).
let _outboxTableReady = false;
async function ensureAiUsageOutboxTable(): Promise<void> {
  if (_outboxTableReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_pending_writes (
        id            TEXT PRIMARY KEY,
        request_id    TEXT UNIQUE NOT NULL,
        org_id        TEXT NOT NULL,
        payload       JSONB NOT NULL,
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`ALTER TABLE ai_usage_pending_writes ENABLE ROW LEVEL SECURITY`);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_usage_pending_writes') THEN
          CREATE POLICY org_isolation ON ai_usage_pending_writes
            USING (org_id = current_setting('app.org_id', true));
        END IF;
      END $$`);
    _outboxTableReady = true;
  } finally { client.release(); }
}

async function enqueueAiUsageOutbox(opts: Parameters<typeof recordCompletedUsage>[0]): Promise<void> {
  await ensureAiUsageOutboxTable();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ai_usage_pending_writes (id, request_id, org_id, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id) DO NOTHING`,
      [`aup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
       opts.requestId, opts.orgId, JSON.stringify(opts)]
    );
  } finally { client.release(); }
}

/** Replay pending usage writes once. Returns number of rows recovered.
 *  Exported for the interval worker AND for restart-recovery tests. */
export async function processAiUsageOutboxOnce(limit = 20): Promise<number> {
  await ensureAiUsageOutboxTable();
  const client = await pool.connect();
  let recovered = 0;
  try {
    const due = await client.query<{ id: string; payload: Parameters<typeof recordCompletedUsage>[0]; attempts: number }>(
      `SELECT id, payload, attempts FROM ai_usage_pending_writes
        WHERE next_retry_at <= NOW() ORDER BY created_at LIMIT $1`,
      [limit]
    );
    for (const row of due.rows) {
      try {
        await recordCompletedUsage(row.payload);
        await client.query(`DELETE FROM ai_usage_pending_writes WHERE id = $1`, [row.id]);
        recovered++;
      } catch (err) {
        const code = (err as Error & { code?: string })?.code;
        if (code === "ORG_NOT_CANONICAL") {
          // Verified absence — replay can never succeed; drop with a loud log.
          logger.error({ id: row.id }, "[AI] outbox: org verified absent — dropping unrecoverable usage row");
          await client.query(`DELETE FROM ai_usage_pending_writes WHERE id = $1`, [row.id]);
          continue;
        }
        const backoffMin = Math.min(60, 2 ** Math.min(row.attempts, 6));
        await client.query(
          `UPDATE ai_usage_pending_writes
              SET attempts = attempts + 1, last_error = $2, next_retry_at = NOW() + ($3 || ' minutes')::interval
            WHERE id = $1`,
          [row.id, String((err as Error)?.message ?? err), String(backoffMin)]
        );
      }
    }
  } finally { client.release(); }
  return recovered;
}

let _outboxWorkerStarted = false;
/** Start the periodic outbox worker (call once at server startup). */
export function startAiUsageOutboxWorker(intervalMs = 60_000): void {
  if (_outboxWorkerStarted) return;
  _outboxWorkerStarted = true;
  const t = setInterval(() => {
    processAiUsageOutboxOnce().then((n) => {
      if (n > 0) logger.info({ recovered: n }, "[AI] usage outbox: recovered pending usage writes");
    }).catch((err) => logger.warn({ err }, "[AI] usage outbox worker tick failed"));
  }, intervalMs);
  (t as { unref?: () => void }).unref?.();
}

async function triggerAIAlert(orgId: string, type: string, current: number, limit: number): Promise<void> {
  const messages: Record<string, string> = {
    quota_70pct:  `70% des AI Credits consommés ce mois (${Math.round(current / 1000)}k / ${Math.round(limit / 1000)}k)`,
    quota_90pct:  `⚠️ 90% des AI Credits consommés — pensez à recharger avant la fin du mois`,
    quota_100pct: `🚨 AI Credits épuisés — toutes les requêtes IA sont bloquées`,
  };
  const client = await pool.connect();
  try {
    const id = `aia_${Date.now()}_${type}`;
    await client.query(
      `INSERT INTO ai_alerts (id, org_id, alert_type, message, threshold, current_value)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [id, orgId, type, messages[type] ?? `Alerte quota IA : ${type}`, limit, current]
    );
    store.broadcast({ type: "ai:quota_alert", alertType: type, current, limit }, orgId);
  } catch { /* silent */ } finally {
    client.release();
  }
}

export async function getAIUsageStats(orgId = "default"): Promise<{
  monthly: Awaited<ReturnType<typeof getOrCreateMonthlyUsage>>;
  byFeature: Array<{ feature: string; credits: number; pct: number; cost: number }>;
  byProvider: Array<{ provider: string; credits: number; pct: number; cost: number }>;
  byModel: Array<{ model: string; credits: number; pct: number; cost: number }>;
  dailyHistory: number[];
  alerts: Array<{ alertType: string; message: string; triggeredAt: Date }>;
  estimatedCostEur: number;
}> {
  // Single source of truth for the monthly balance, including purchased packs
  // (ai_credit_purchases) — same path as quota checks in getOrCreateMonthlyUsage.
  const canonicalMonthly = await getOrCreateMonthlyUsage(orgId).catch(() => ({
    creditsUsed: 0, creditsLimit: planCreditLimit("standard"), creditsExtra: 0,
    costEur: 0, requestCount: 0, tokensUsed: 0,
    tokenLimit: PLAN_AI_TOKENS.standard, resetAt: monthResetDate(),
  }));

  const fallback = {
    monthly: {
      ...canonicalMonthly,
    },
    byFeature: [] as Array<{ feature: string; credits: number; pct: number; cost: number }>,
    byProvider: [] as Array<{ provider: string; credits: number; pct: number; cost: number }>,
    byModel: [] as Array<{ model: string; credits: number; pct: number; cost: number }>,
    dailyHistory: Array.from({ length: 30 }, () => 0),
    alerts: [] as Array<{ alertType: string; message: string; triggeredAt: Date }>,
    estimatedCostEur: 0,
  };

  try {
    type LogRow    = { feature: string; credits: string; cost: string };
    type ProviderRow = { provider: string; credits: string; cost: string };
    type ModelRow    = { model: string; credits: string; cost: string };
    type AlertRow  = { alert_type: string; message: string; triggered_at: Date };
    type DailyRow  = { day: string; credits: string };

    const [byFeature, byProvider, byModel, alerts, dailyHistory] = await withOrgDb<
      [typeof fallback.byFeature, typeof fallback.byProvider, typeof fallback.byModel, typeof fallback.alerts, number[]]
    >(orgId, async (client) => {
      const [lRes, pRes, moRes, aRes, dRes] = await Promise.all([
        client.query<LogRow>(
          `SELECT feature, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 AND created_at >= date_trunc('month', NOW())
           GROUP BY feature LIMIT 20`,
          [orgId]
        ),
        client.query<ProviderRow>(
          `SELECT provider, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 AND created_at >= date_trunc('month', NOW())
           GROUP BY provider LIMIT 20`,
          [orgId]
        ),
        client.query<ModelRow>(
          `SELECT model, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 AND created_at >= date_trunc('month', NOW())
           GROUP BY model LIMIT 20`,
          [orgId]
        ),
        client.query<AlertRow>(
          `SELECT alert_type, message, triggered_at
           FROM ai_alerts WHERE org_id=$1 ORDER BY triggered_at DESC LIMIT 5`,
          [orgId]
        ),
        client.query<DailyRow>(
          `SELECT date_trunc('day', created_at)::date::text AS day,
                  SUM(credits_used)::text AS credits
           FROM ai_usage_logs
           WHERE org_id=$1 AND created_at >= NOW() - INTERVAL '30 days'
           GROUP BY date_trunc('day', created_at) ORDER BY 1`,
          [orgId]
        ),
      ]);

      const total = lRes.rows.reduce((s, l) => s + Number(l.credits), 0) || 1;
      const bf = lRes.rows.map(l => ({
        feature: l.feature,
        credits: Number(l.credits),
        pct:     Math.round((Number(l.credits) / total) * 100),
        cost:    Number(l.cost),
      }));
      const bp = pRes.rows.map(l => ({
        provider: l.provider,
        credits: Number(l.credits),
        pct:     Math.round((Number(l.credits) / total) * 100),
        cost:    Number(l.cost),
      }));
      const bm = moRes.rows.map(l => ({
        model: l.model,
        credits: Number(l.credits),
        pct:     Math.round((Number(l.credits) / total) * 100),
        cost:    Number(l.cost),
      }));

      const al = aRes.rows.map(r => ({
        alertType:   r.alert_type,
        message:     r.message,
        triggeredAt: r.triggered_at,
      }));

      const dayMap = new Map(dRes.rows.map(l => [l.day, Number(l.credits)]));
      const dh = Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        return dayMap.get(d.toISOString().slice(0, 10)) ?? 0;
      });

      return [bf, bp, bm, al, dh];
    });

    const estimatedCostEur = byFeature.reduce((s, f) => s + (f.cost || 0), 0);
    return { monthly: canonicalMonthly, byFeature, byProvider, byModel, alerts, dailyHistory, estimatedCostEur };
  } catch (err) {
    logger.error({ err }, "[AI] getAIUsageStats failed — returning plan-based fallback");
    return fallback;
  }
}
