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
  if (Number.isFinite(n) && n >= 1 && n <= 30) {
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
        allowed: ["today", "3d", "7d", "30d"],
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
  | { status: "ready";                  text: string; generatedAt: string; cached: boolean }
  | { status: "no_data" }
  | { status: "quota_exhausted";        resetHint: string }
  | { status: "temporarily_unavailable"; retryAfterMs: number }
  | { status: "configuration_error" };

// ── In-process hot cache (avoids DB round-trip for bursts) ──────────────────
const _insightsHot = new Map<string, { text: string; hash: string; expiresAt: number }>();

// ── GET /overview/insights — AI executive insights, quota-gated, PG-cached ─
router.get("/overview/insights", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";

    // ── 1. Build context string (real DB data) ──────────────────────────────
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
      Number(aud?.cnt)   > 0 ? `Score SEO moyen: ${aud!.avg}/100 (${aud!.cnt} audits, min ${aud!.low}, max ${aud!.high})` : "",
      Number(kw?.total)  > 0 ? `Mots-clés: ${kw!.total} suivis, ${kw!.up} en hausse, ${kw!.top10} top-10` : "",
      Number(mon?.total) > 0 ? `Monitors: ${mon!.total} total, ${mon!.down} DOWN` : "",
      Number(msn?.total) > 0 ? `Missions: ${msn!.done}/${msn!.total} complétées` : "",
      Number(cmp?.cnt)   > 0 ? `Concurrents: ${cmp!.cnt} suivis` : "",
      Number(leak?.total) > 0 ? `Opportunité revenue: ${Math.round(Number(leak!.total))}€` : "",
    ].filter(Boolean);

    // ── 2. Quota check (before no_data — quota_exhausted has higher priority) ──
    let planRow: { plan?: string } | null = null;
    try {
      const planRes = await pool.query(`SELECT plan FROM org_settings WHERE org_id=$1 LIMIT 1`, [orgId]);
      planRow = planRes.rows[0] ?? null;
    } catch { /* ignore */ }

    const quota = await checkAIQuota({ feature: "overview_insights", orgId });
    if (!quota.allowed) {
      const resp: InsightResponse = {
        status:    "quota_exhausted",
        resetHint: "Les crédits IA seront renouvelés en début de mois prochain.",
      };
      return res.json(resp);
    }

    if (ctxLines.length === 0) {
      const resp: InsightResponse = { status: "no_data" };
      return res.json(resp);
    }

    const ctx      = ctxLines.join(". ");
    const ctxHash  = createHash("sha256").update(ctx).digest("hex").slice(0, 16);

    // ── 3. Hot memory cache ─────────────────────────────────────────────────
    const hot = _insightsHot.get(orgId);
    if (hot && hot.hash === ctxHash && hot.expiresAt > Date.now()) {
      const resp: InsightResponse = { status: "ready", text: hot.text, generatedAt: new Date(hot.expiresAt - 5 * 60_000).toISOString(), cached: true };
      return res.json(resp);
    }

    // ── 4. PostgreSQL persistent cache ─────────────────────────────────────
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

    // ── 5. Generate with AI ─────────────────────────────────────────────────
    const t0 = Date.now();
    let aiText = "";
    let tokensIn = 0, tokensOut = 0;
    let success = false;

    try {
      const result = await aiChat({
        provider:     "openai",
        model:        "gpt-4o-mini",
        systemPrompt: "Tu es un consultant SEO expert FlowPoint. Génère une analyse concise et actionnable en 2-3 phrases max. Utilise exclusivement les données fournies. Langue : français. Pas de bullets, pas de titres.",
        userPrompt:   `Analyse ces métriques et indique la priorité d'action immédiate : ${ctx}`,
        maxTokens:    220,
        temperature:  0.4,
      });
      aiText    = result.text?.trim() ?? "";
      tokensIn  = result.usage?.promptTokens     ?? 0;
      tokensOut = result.usage?.completionTokens ?? 0;
      success   = aiText.length > 0;
    } catch (aiErr) {
      void aiErr;
      const resp: InsightResponse = { status: "temporarily_unavailable", retryAfterMs: 30_000 };
      return res.json(resp);
    }

    const latencyMs = Date.now() - t0;

    // ── 6. Record usage ─────────────────────────────────────────────────────
    await recordCompletedUsage({
      orgId,
      feature:   "overview_insights",
      userId:    "service",
      model:     "gpt-4o-mini",
      tokensIn,
      tokensOut,
      latencyMs,
      success,
    }).catch(() => { /* non-blocking */ });

    if (!success) {
      const resp: InsightResponse = { status: "temporarily_unavailable", retryAfterMs: 60_000 };
      return res.json(resp);
    }

    // ── 7. Persist in PostgreSQL + hot cache (5 min TTL) ───────────────────
    const generatedAt  = new Date().toISOString();
    const expiresInMin = 5;

    try {
      await pool.query(
        `INSERT INTO overview_insights_cache (org_id, content, context_hash, generated_at, expires_at)
         VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '${expiresInMin} minutes')
         ON CONFLICT (org_id) DO UPDATE
           SET content = EXCLUDED.content, context_hash = EXCLUDED.context_hash,
               generated_at = EXCLUDED.generated_at, expires_at = EXCLUDED.expires_at`,
        [orgId, aiText, ctxHash]
      );
    } catch { /* DB write failure is non-fatal */ }

    _insightsHot.set(orgId, { text: aiText, hash: ctxHash, expiresAt: Date.now() + expiresInMin * 60_000 });

    const resp: InsightResponse = { status: "ready", text: aiText, generatedAt, cached: false };
    return res.json(resp);
  } catch {
    const resp: InsightResponse = { status: "temporarily_unavailable", retryAfterMs: 60_000 };
    return res.status(500).json(resp);
  }
});

export default router;
