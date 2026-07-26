import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { getOverviewMetrics } from "../services/overview-service.js";
import { aiChat } from "../services/ai-provider.js";
import { checkAIQuota, recordCompletedUsage } from "../services/ai-engine.js";
import { pool } from "@workspace/db";

const router = Router();

// ── Range label parsing ─────────────────────────────────────────────────────
const RANGE_MAP: Record<string, number> = {
  today: 1,
  "1d":  1,
  "3d":  3,
  "7d":  7,
  "30d": 30,
  "90d": 90,
};

/**
 * Parse ?range from query string.
 * Accepts string labels (today, 3d, 7d, 30d) or plain integers (1, 3, 7, 30).
 * Returns { days: number, label: string } or { error } for invalid input.
 */
function parseRange(raw: string | undefined): { days: number; label: string } | { error: true } {
  if (!raw) return { days: 30, label: "30d" };

  // String label (today, 3d, 7d, 30d)
  if (raw in RANGE_MAP) return { days: RANGE_MAP[raw]!, label: raw };

  // Pure integer fallback (legacy / direct API calls)
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 90) {
    const label = n === 1 ? "today" : `${n}d`;
    return { days: n, label };
  }

  return { error: true };
}

// ── GET /overview — aggregate metrics for the Overview dashboard page ─────────
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";

    const parsed = parseRange(req.query["range"] as string | undefined);
    if ("error" in parsed) {
      res.status(400).json({
        error: "Invalid range parameter",
        code: "INVALID_RANGE",
        allowed: ["today", "3d", "7d", "30d", "90d"],
        received: req.query["range"],
      });
      return;
    }

    const metrics = await getOverviewMetrics(orgId, parsed.days, parsed.label);
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=30");
    res.json(metrics);
  } catch {
    res.status(500).json({ error: "Failed to compute overview metrics" });
  }
});

// ── GET /overview/checklist — load persisted checklist items and extra state ─
router.get("/overview/checklist", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";
    const result = await pool.query(
      `SELECT items, extra FROM org_checklist WHERE org_id = $1`,
      [orgId]
    );
    if (result.rows.length === 0) {
      res.json({ items: null, extra: null });
    } else {
      res.json({
        items: result.rows[0].items ?? null,
        extra: result.rows[0].extra ?? null,
      });
    }
  } catch {
    res.status(500).json({ error: "Failed to fetch checklist" });
  }
});

// ── PUT /overview/checklist — persist checklist state server-side ─────────────
// Accepts partial payloads: { items } | { extra } | { items, extra }
// Absent fields preserve their existing value in DB.
// Shorthand: { completedItems: string[] } → extra map
router.put("/overview/checklist", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";

    const body = req.body as Record<string, unknown>;

    // Support shorthand: completedItems → extra map { id → true }
    if (Array.isArray(body.completedItems) && !Object.prototype.hasOwnProperty.call(body, "items") && !Object.prototype.hasOwnProperty.call(body, "extra")) {
      body.extra = Object.fromEntries((body.completedItems as string[]).map((id) => [id, true]));
    }

    const hasItems = Object.prototype.hasOwnProperty.call(body, "items");
    const hasExtra = Object.prototype.hasOwnProperty.call(body, "extra");

    // Reject empty update
    if (!hasItems && !hasExtra) {
      return res.status(400).json({
        error: "At least one checklist field is required",
        code: "CHECKLIST_EMPTY_UPDATE",
      });
    }

    // Validate types
    if (hasItems && !Array.isArray(body.items)) {
      return res.status(400).json({
        error: "items must be an array",
        code: "CHECKLIST_INVALID_PAYLOAD",
      });
    }
    if (hasExtra && (body.extra === null || typeof body.extra !== "object" || Array.isArray(body.extra))) {
      return res.status(400).json({
        error: "extra must be an object",
        code: "CHECKLIST_INVALID_PAYLOAD",
      });
    }

    const result = await pool.query(
      `INSERT INTO org_checklist (org_id, items, extra, updated_at)
       VALUES (
         $1,
         COALESCE($2::jsonb, '[]'::jsonb),
         COALESCE($3::jsonb, '{}'::jsonb),
         NOW()
       )
       ON CONFLICT (org_id) DO UPDATE SET
         items      = CASE WHEN $4::boolean THEN EXCLUDED.items      ELSE org_checklist.items END,
         extra      = CASE WHEN $5::boolean THEN EXCLUDED.extra      ELSE org_checklist.extra END,
         updated_at = NOW()
       RETURNING items, extra, updated_at`,
      [
        orgId,
        hasItems ? JSON.stringify(body.items) : null,
        hasExtra ? JSON.stringify(body.extra)  : null,
        hasItems,
        hasExtra,
      ]
    );

    const row = result.rows[0];
    return res.json({ ok: true, items: row?.items ?? [], extra: row?.extra ?? {}, updatedAt: row?.updated_at });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save checklist" });
  }
});

// ── Typed insight response ──────────────────────────────────────────────────
type InsightResponse =
  | { status: "ready";                   text: string; generatedAt: string; cached: boolean }
  | { status: "no_data" }
  | { status: "quota_exhausted";         resetHint: string }
  | { status: "rate_limited";            retryAfterSeconds: number }
  | { status: "temporarily_unavailable"; retryAfterMs: number }
  | { status: "configuration_error" };

// ── Rate-limit / mutex constants ────────────────────────────────────────────
const INSIGHTS_MAX_GEN       = 3;          // max new OpenAI calls per window per org
const INSIGHTS_WINDOW_S      = 10 * 60;   // 10-minute rolling window (seconds)
const INSIGHTS_GEN_TIMEOUT_S = 120;       // stale-lock TTL: max seconds a generation may hold the mutex
const INSIGHTS_COST_CREDITS  = 500;       // fixed credits per successful generation

// ── In-process hot cache (avoids DB round-trip for repeated identical context) ──
const _insightsHot = new Map<string, { text: string; hash: string; expiresAt: number }>();

// ── PG-based distributed slot acquire (rate limit + mutex) ──────────────────
// Returns { ok: true } when the slot is acquired (generating=true committed to DB),
// or { ok: false, retryAfterSeconds } when rate-limited or concurrent lock held.
async function _acquireInsightsSlot(
  orgId: string
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure the row exists (idempotent)
    await client.query(
      `INSERT INTO overview_insights_rl (org_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [orgId]
    );

    // Lock the row exclusively for this transaction
    const { rows: [row] } = await client.query(
      `SELECT * FROM overview_insights_rl WHERE org_id=$1 FOR UPDATE`,
      [orgId]
    );

    const now          = Date.now();
    const windowStart  = new Date(row.window_start as string).getTime();
    const windowExpired = (now - windowStart) >= INSIGHTS_WINDOW_S * 1_000;
    const effectiveCount = windowExpired ? 0 : (row.gen_count as number);
    const effectiveWindowStart = windowExpired ? new Date(now).toISOString() : (row.window_start as string);

    // Concurrent-generation check (stale lock recovery)
    const isGenerating = row.generating as boolean;
    const genStarted   = row.gen_started ? new Date(row.gen_started as string).getTime() : 0;
    const lockIsStale  = genStarted > 0 && (now - genStarted) > INSIGHTS_GEN_TIMEOUT_S * 1_000;

    if (isGenerating && !lockIsStale) {
      const retryAfterSeconds = Math.max(1,
        Math.ceil((genStarted + INSIGHTS_GEN_TIMEOUT_S * 1_000 - now) / 1_000)
      );
      await client.query("ROLLBACK");
      return { ok: false, retryAfterSeconds };
    }

    // Rate-limit check (max generations per window)
    if (effectiveCount >= INSIGHTS_MAX_GEN) {
      const windowEnd = windowExpired
        ? now + INSIGHTS_WINDOW_S * 1_000
        : windowStart + INSIGHTS_WINDOW_S * 1_000;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1_000));
      await client.query("ROLLBACK");
      return { ok: false, retryAfterSeconds };
    }

    // Acquire: mark generating=true, set window state
    await client.query(
      `UPDATE overview_insights_rl
       SET generating=true, gen_started=NOW(), window_start=$2, gen_count=$3
       WHERE org_id=$1`,
      [orgId, effectiveWindowStart, effectiveCount]
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── Release slot after generation attempt ────────────────────────────────────
async function _releaseInsightsSlot(orgId: string, succeeded: boolean): Promise<void> {
  try {
    await pool.query(
      `UPDATE overview_insights_rl
       SET generating = false,
           gen_count  = gen_count + $2,
           last_gen_at = CASE WHEN $2 = 1 THEN NOW() ELSE last_gen_at END
       WHERE org_id = $1`,
      [orgId, succeeded ? 1 : 0]
    );
  } catch { /* non-fatal */ }
}

// ── GET /overview/insights — AI executive insights, quota + rate-limit gated ─
router.get("/overview/insights", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";

    // ── 1. Build context from real DB data ──────────────────────────────────
    const [auditQ, kwnQ, monQ, msnQ, compQ, leakQ] = await Promise.allSettled([
      pool.query(
        `SELECT ROUND(AVG(score))::int AS avg, COUNT(*) AS cnt,
                MIN(score)::int AS low, MAX(score)::int AS high
         FROM audits WHERE org_id=$1 AND created_at > NOW() - INTERVAL '30 days'`,
        [orgId]
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN trend='up' THEN 1 ELSE 0 END) AS up,
                SUM(CASE WHEN current_position<=10 THEN 1 ELSE 0 END) AS top10
         FROM tracked_keywords WHERE org_id=$1 AND active=true`,
        [orgId]
      ),
      pool.query(
        `SELECT SUM(CASE WHEN status='down' THEN 1 ELSE 0 END) AS down,
                COUNT(*) AS total
         FROM monitors WHERE org_id=$1`,
        [orgId]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status='done') AS done,
                COUNT(*) AS total
         FROM missions WHERE org_id=$1`,
        [orgId]
      ),
      pool.query(`SELECT COUNT(*) AS cnt FROM competitors WHERE org_id=$1`, [orgId]),
      pool.query(
        `SELECT COALESCE(SUM(estimated_loss),0) AS total FROM revenue_leaks WHERE org_id=$1 AND status='active'`,
        [orgId]
      ),
    ]);

    const aud  = auditQ.status  === "fulfilled" ? auditQ.value.rows[0]  : null;
    const kw   = kwnQ.status    === "fulfilled" ? kwnQ.value.rows[0]    : null;
    const mon  = monQ.status    === "fulfilled" ? monQ.value.rows[0]    : null;
    const msn  = msnQ.status    === "fulfilled" ? msnQ.value.rows[0]    : null;
    const cmp  = compQ.status   === "fulfilled" ? compQ.value.rows[0]   : null;
    const leak = leakQ.status   === "fulfilled" ? leakQ.value.rows[0]   : null;

    const ctxLines = [
      Number(aud?.cnt)    > 0 ? `Score SEO moyen: ${aud!.avg}/100 (${aud!.cnt} audits, min ${aud!.low}, max ${aud!.high})` : "",
      Number(kw?.total)   > 0 ? `Mots-clés: ${kw!.total} suivis, ${kw!.up} en hausse, ${kw!.top10} top-10` : "",
      Number(mon?.total)  > 0 ? `Monitors: ${mon!.total} total, ${mon!.down} DOWN` : "",
      Number(msn?.total)  > 0 ? `Missions: ${msn!.done}/${msn!.total} complétées` : "",
      Number(cmp?.cnt)    > 0 ? `Concurrents: ${cmp!.cnt} suivis` : "",
      Number(leak?.total) > 0 ? `Opportunité revenue: ${Math.round(Number(leak!.total))}€` : "",
    ].filter(Boolean);

    // ── 2. Quota check (highest priority — always before any generation) ────
    const quota = await checkAIQuota({ feature: "overview_insights", orgId });
    if (!quota.allowed) {
      const resp: InsightResponse = {
        status:    "quota_exhausted",
        resetHint: "Les crédits IA seront renouvelés en début de mois prochain.",
      };
      return res.json(resp);
    }

    // ── 3. No-data guard ────────────────────────────────────────────────────
    if (ctxLines.length === 0) {
      return res.json({ status: "no_data" } as InsightResponse);
    }

    const ctx     = ctxLines.join(". ");
    const ctxHash = createHash("sha256").update(ctx).digest("hex").slice(0, 16);

    // ── 4. Hot in-process cache (cache hits never consume credits or a slot) ─
    const hot = _insightsHot.get(orgId);
    if (hot && hot.hash === ctxHash && hot.expiresAt > Date.now()) {
      const resp: InsightResponse = {
        status: "ready", text: hot.text,
        generatedAt: new Date(hot.expiresAt - 5 * 60_000).toISOString(),
        cached: true,
      };
      return res.json(resp);
    }

    // ── 5. PostgreSQL persistent cache (cache hits never consume credits) ───
    try {
      const pgRow = await pool.query(
        `SELECT content, context_hash, generated_at FROM overview_insights_cache
         WHERE org_id=$1 AND expires_at > NOW()`,
        [orgId]
      );
      if (pgRow.rows.length > 0 && pgRow.rows[0].context_hash === ctxHash) {
        const text = pgRow.rows[0].content as string;
        const generatedAt = (pgRow.rows[0].generated_at as Date).toISOString();
        _insightsHot.set(orgId, { text, hash: ctxHash, expiresAt: Date.now() + 5 * 60_000 });
        const resp: InsightResponse = { status: "ready", text, generatedAt, cached: true };
        return res.json(resp);
      }
    } catch { /* DB unavailable — proceed to generate */ }

    // ── 6. Acquire generation slot (PG-based rate limit + mutex) ───────────
    let slotAcquired = false;
    try {
      const slot = await _acquireInsightsSlot(orgId);
      if (!slot.ok) {
        const resp: InsightResponse = { status: "rate_limited", retryAfterSeconds: slot.retryAfterSeconds };
        return res.status(429).json(resp);
      }
      slotAcquired = true;
    } catch {
      // If PG is unreachable, allow generation (degraded mode, no rate limit)
    }

    // ── 7. Generate with OpenAI ─────────────────────────────────────────────
    const t0 = Date.now();
    let aiText   = "";
    let tokensIn = 0, tokensOut = 0;
    let genSucceeded = false;

    try {
      const result = await aiChat({
        provider:     "openai",
        model:        "gpt-4o-mini",
        systemPrompt: "Tu es un consultant SEO expert FlowPoint. Génère une analyse concise et actionnable en 2-3 phrases max. Utilise exclusivement les données fournies. Langue : français. Pas de bullets, pas de titres.",
        userPrompt:   `Analyse ces métriques et indique la priorité d'action immédiate : ${ctx}`,
        maxTokens:    220,
        temperature:  0.4,
      });
      aiText       = result.text?.trim() ?? "";
      tokensIn     = result.usage?.promptTokens     ?? 0;
      tokensOut    = result.usage?.completionTokens ?? 0;
      genSucceeded = aiText.length > 0;
    } catch (aiErr) {
      void aiErr;
      if (slotAcquired) await _releaseInsightsSlot(orgId, false);
      const resp: InsightResponse = { status: "temporarily_unavailable", retryAfterMs: 30_000 };
      return res.json(resp);
    }

    const latencyMs = Date.now() - t0;

    // ── 8. Release slot (increment gen_count only on success) ───────────────
    if (slotAcquired) await _releaseInsightsSlot(orgId, genSucceeded);

    // ── 9. Record usage — only on real successful generation (500 credits) ──
    if (genSucceeded) {
      recordCompletedUsage({
        orgId,
        feature:         "overview_insights",
        userId:          "service",
        model:           "gpt-4o-mini",
        tokensIn,
        tokensOut,
        latencyMs,
        success:         true,
        fixedCreditCost: INSIGHTS_COST_CREDITS,  // always 500, never discounted by model multiplier
      }).catch(() => { /* non-blocking */ });
    }

    if (!genSucceeded) {
      const resp: InsightResponse = { status: "temporarily_unavailable", retryAfterMs: 60_000 };
      return res.json(resp);
    }

    // ── 10. Persist in PG cache + hot cache (5 min TTL) ────────────────────
    const generatedAt  = new Date().toISOString();
    const expiresInMin = 5;

    pool.query(
      `INSERT INTO overview_insights_cache (org_id, content, context_hash, generated_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '${expiresInMin} minutes')
       ON CONFLICT (org_id) DO UPDATE
         SET content = EXCLUDED.content, context_hash = EXCLUDED.context_hash,
             generated_at = EXCLUDED.generated_at, expires_at = EXCLUDED.expires_at`,
      [orgId, aiText, ctxHash]
    ).catch(() => { /* non-fatal */ });

    _insightsHot.set(orgId, { text: aiText, hash: ctxHash, expiresAt: Date.now() + expiresInMin * 60_000 });

    const resp: InsightResponse = { status: "ready", text: aiText, generatedAt, cached: false };
    return res.json(resp);
  } catch {
    const resp: InsightResponse = { status: "temporarily_unavailable", retryAfterMs: 60_000 };
    return res.status(500).json(resp);
  }
});

export default router;
