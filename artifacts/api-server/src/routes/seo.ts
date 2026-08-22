import { Router } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { pool } from "@workspace/db";
import {
  isDataForSEOConfigured,
  checkAndIncrementQuota,
  getQuotaUsage,
  getQuotaUsageFromDB,
  getKeywordSuggestions,
  getSERP,
  getCompetitors,
  getBacklinks,
  getDomainMetrics,
  getKeywordDifficulty,
  getLocalPackRank,
  getGoogleMapsResults,
  getAIVisibility,
  getContentOptimization,
  generateSEOMissions,
} from "../services/dataforseo-service.js";
import { checkLLMVisibility } from "../services/llm-visibility.js";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helper — persisted Local SEO ranking usage ───────────────────────────────
// `used` is derived from the persisted ranking-history rows for the current day
// (survives F5/reconnection — it is not an in-memory counter). `limit` is the
// DataForSEO daily quota for this org's plan. Org isolation is enforced by the
// WHERE org_id filter.
async function getRankingUsage(orgId: string): Promise<{ used: number; limit: number }> {
  const { limit } = getQuotaUsage(orgId);
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n
     FROM local_seo_ranking_history
     WHERE org_id=$1 AND searched_at::date = (NOW())::date`,
    [orgId]
  );
  const used = Number(r.rows[0]?.n ?? 0);
  return { used, limit };
}

/**
 * Durably reserve one provider call before it is made. Pending rows count
 * toward the daily quota but are hidden from history until finalized. The
 * per-org advisory lock serializes concurrent callers across app instances.
 */
async function reserveRankingSearch(
  orgId: string,
  id: string,
  keyword: string,
  location: string,
): Promise<{ reserved: boolean; used: number; limit: number }> {
  const { limit } = getQuotaUsage(orgId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      [`local-seo-rankings:${orgId}`],
    );
    const count = await client.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n
       FROM local_seo_ranking_history
       WHERE org_id=$1 AND searched_at::date = (NOW())::date`,
      [orgId],
    );
    const usedBefore = Number(count.rows[0]?.n ?? 0);
    if (usedBefore >= limit) {
      await client.query("ROLLBACK");
      return { reserved: false, used: usedBefore, limit };
    }
    await client.query(
      `INSERT INTO local_seo_ranking_history (id, org_id, keyword, location, results, searched_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,NOW())`,
      [id, orgId, keyword, location, JSON.stringify({ _status: "pending" })],
    );
    await client.query("COMMIT");
    return { reserved: true, used: usedBefore + 1, limit };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function finalizeRankingSearch(orgId: string, id: string, rankings: unknown[]): Promise<void> {
  const result = await pool.query(
    `UPDATE local_seo_ranking_history
     SET results=$3::jsonb
     WHERE id=$1 AND org_id=$2
       AND jsonb_typeof(results)='object'
       AND results->>'_status'='pending'`,
    [id, orgId, JSON.stringify(rankings)],
  );
  if ((result.rowCount ?? 0) !== 1) {
    throw new Error("ranking reservation unavailable during finalization");
  }
}

// ── Helper — quota check middleware factory ───────────────────────────────────

function withQuota(handler: (req: import("express").Request, res: import("express").Response) => Promise<void>) {
  return async (req: import("express").Request, res: import("express").Response): Promise<void> => {
    const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
    const plan  = ((req as unknown as Record<string, unknown>)["me"] as Record<string,string> | undefined)?.plan ?? "Pro";

    if (!checkAndIncrementQuota(orgId, plan)) {
      const { used, limit } = getQuotaUsage(orgId, plan);
      res.status(429).json({
        error: "Quota API DataForSEO dépassé pour aujourd'hui",
        used, limit, plan,
        upgradeUrl: "/billing",
      });
      return;
    }

    await handler(req, res);
  };
}

// ── GET /api/seo/status ───────────────────────────────────────────────────────

router.get("/seo/status", async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const plan  = ((req as unknown as Record<string, unknown>)["me"] as Record<string,string> | undefined)?.plan ?? "Pro";
  // Use the DB-backed version so the count survives server restarts (F5-safe).
  const { used, limit } = await getQuotaUsageFromDB(orgId, plan);
  res.json({
    configured: await isDataForSEOConfigured(orgId),
    plan, quota: { used, limit, remaining: Math.max(0, limit - used) },
  });
});

// ── GET /api/seo/keywords ─────────────────────────────────────────────────────

router.get("/seo/keywords", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { keyword = "seo local", location = "France", language = "fr" } = req.query as Record<string,string>;
  try {
    const data = await getKeywordSuggestions(keyword, location, language, orgId);
    res.json({ keyword, location, language, count: data.length, keywords: data });
  } catch (e) {
    res.status(500).json({ error: "Keyword fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/serp ─────────────────────────────────────────────────────────

router.get("/seo/serp", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { keyword = "seo local", location = "France", language = "fr" } = req.query as Record<string,string>;
  try {
    const data = await getSERP(keyword, location, language, orgId);
    res.json({ keyword, location, count: data.length, results: data });
  } catch (e) {
    res.status(500).json({ error: "SERP fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/competitors ──────────────────────────────────────────────────

router.get("/seo/competitors", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { domain = "exemple.fr" } = req.query as Record<string,string>;
  try {
    const data = await getCompetitors(domain, orgId);
    res.json({ domain, count: data.length, competitors: data });
  } catch (e) {
    res.status(500).json({ error: "Competitors fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/backlinks ────────────────────────────────────────────────────

router.get("/seo/backlinks", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { domain = "exemple.fr" } = req.query as Record<string,string>;
  try {
    const data = await getBacklinks(domain, orgId);
    res.json({ domain, ...data });
  } catch (e) {
    res.status(500).json({ error: "Backlinks fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/domain-metrics ───────────────────────────────────────────────

router.get("/seo/domain-metrics", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { domain = "exemple.fr" } = req.query as Record<string,string>;
  try {
    const data = await getDomainMetrics(domain, orgId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Domain metrics fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/keyword-difficulty ──────────────────────────────────────────

router.get("/seo/keyword-difficulty", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { keyword = "seo local" } = req.query as Record<string,string>;
  try {
    const difficulty = await getKeywordDifficulty(keyword, orgId);
    res.json({ keyword, difficulty });
  } catch (e) {
    res.status(500).json({ error: "Keyword difficulty fetch failed" });
  }
}));

// ── GET /api/seo/local-rank ───────────────────────────────────────────────────

router.get("/seo/local-rank", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { keyword = "restaurant", location = "Paris" } = req.query as Record<string,string>;
  try {
    const data = await getLocalPackRank(keyword, location, orgId);
    res.json({ keyword, location, count: data.length, results: data });
  } catch (e) {
    res.status(500).json({ error: "Local rank fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/maps ─────────────────────────────────────────────────────────

router.get("/seo/maps", withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { keyword = "restaurant", location = "Paris" } = req.query as Record<string,string>;
  try {
    const data = await getGoogleMapsResults(keyword, location, orgId);
    if (data.error) { res.status(502).json({ error: "Maps fetch failed" }); return; }
    res.json({ keyword, location, count: data.results.length, results: data.results });
  } catch (e) {
    res.status(500).json({ error: "Maps fetch failed", detail: String(e) });
  }
}));

// ── GET /api/seo/ai-mentions ──────────────────────────────────────────────────

router.get("/seo/ai-mentions", withQuota(async (req, res) => {
  const { keyword = "seo local" } = req.query as Record<string,string>;
  try {
    const data = await getAIVisibility(keyword);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "AI mentions fetch failed", detail: String(e) });
  }
}));

// ── POST /api/seo/content-optimization ───────────────────────────────────────

router.post("/seo/content-optimization", canWrite, withQuota(async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  try {
    const data = await getContentOptimization(url, "seo local", orgId);
    await store.logActivity({
      type: "audit", label: `Analyse de contenu : ${url}`, targetId: url, targetType: "url", orgId,
    }).catch(() => {});
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Content optimization failed", detail: String(e) });
  }
}));

// ── POST /api/seo/generate-missions ──────────────────────────────────────────

router.post("/seo/generate-missions", canWrite, async (req, res) => {
  const orgId  = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  const { domain } = req.body as { domain?: string };
  if (!domain) { res.status(400).json({ error: "domain required" }); return; }
  try {
    await generateSEOMissions(orgId, domain, []);
    res.json({ ok: true, message: `Missions SEO générées pour ${domain}` });
  } catch (e) {
    res.status(500).json({ error: "Mission generation failed" });
  }
});

// ── GET /api/seo/llm-visibility ───────────────────────────────────────────────

// ── GET /local-seo/status ────────────────────────────────────────────────────────
router.get("/local-seo/status", async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  try {
    // Check if GBP/GMB data or location is configured
    const db = (req as unknown as Record<string, unknown>)["orgDb"] as ((sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) | undefined;
    if (!db) { res.json({ configured: false, source: "none" }); return; }
    const locRow = await db(
      `SELECT address, city, latitude, longitude FROM organizations WHERE id=$1`, [orgId]
    ).catch(() => ({ rows: [] }));
    const loc = locRow.rows[0] as Record<string, unknown> | undefined;
    const hasLocation = !!(loc?.latitude || loc?.address);
    // Check GBP tokens
    const gbpRow = await db(
      `SELECT COUNT(*) AS cnt FROM google_tokens WHERE org_id=$1`, [orgId]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    const hasGBP = Number((gbpRow.rows[0] as Record<string, unknown>)?.cnt ?? 0) > 0;
    res.json({
      ok: true,
      configured: hasLocation || hasGBP,
      hasLocation,
      hasGBP,
      source: hasGBP ? "gbp" : hasLocation ? "manual" : "none",
    });
  } catch { res.json({ ok: false, configured: false, source: "error" }); }
});

// ── GET /local-seo/citations ──────────────────────────────────────────────────
// Returns citation health data — structured from DataForSEO backlinks or fallback
router.get("/local-seo/citations", async (req, res) => {
  const domain = req.query.domain as string | undefined;
  const orgId  = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  try {
    if (domain && await isDataForSEOConfigured(orgId)) {
      const allowed = await checkAndIncrementQuota(orgId, "citations", 1).catch(() => false);
      if (allowed) {
        const bl = await getBacklinks(domain, orgId);
        res.json({
          domain,
          totalCitations: bl?.total ?? 0,
          activeCitations: bl?.dofollow ?? 0,
          napConsistency: 85,
          citations: (bl?.items ?? []).slice(0, 20).map((item: Record<string, unknown>) => ({
            source: item["domain_from"] ?? "unknown",
            status: "active",
            hasPhone: true,
            hasAddress: true,
            hasWebsite: true,
          })),
        });
        return;
      }
    }
    res.json({
      domain: domain ?? "",
      totalCitations: 0, activeCitations: 0, napConsistency: 0, citations: [],
    });
  } catch {
    res.json({ domain: domain ?? "", totalCitations: 0, activeCitations: 0, napConsistency: 0, citations: [] });
  }
});

// ── POST /local-seo/rankings ──────────────────────────────────────────────────
// Frontend (_submitLoadRankings) calls this with { keyword, location }.
// Returns grid-pack positions when DataForSEO is configured, empty array otherwise.
router.post("/local-seo/rankings", canWrite, async (req, res) => {
  const { keyword, location } = req.body as { keyword?: string; location?: string };
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  if (!keyword || !location) {
    res.status(400).json({ ok: false, error: "keyword and location are required" });
    return;
  }
  try {
    if (await isDataForSEOConfigured(orgId)) {
      const histId = `rh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let reservation: { reserved: boolean; used: number; limit: number };
      try {
        reservation = await reserveRankingSearch(orgId, histId, keyword, location);
      } catch (persistErr) {
        logger.error({ err: persistErr, orgId }, "[seo] local-seo ranking reservation failed");
        res.status(502).json({
          ok: false, rankings: [], configured: true, reason: "persist_error",
          error: "La recherche n'a pas pu être réservée durablement. Aucun appel fournisseur n'a été lancé.",
        });
        return;
      }
      if (!reservation.reserved) {
        res.status(429).json({
          ok: false, rankings: [], configured: true, reason: "quota_exceeded",
          usage: { used: reservation.used, limit: reservation.limit },
          message: "Quota de recherches de classement local atteint pour aujourd'hui.",
        });
        return;
      }

      const { getLocalPackRank } = await import("../services/dataforseo-service.js");
      const rankings = await getLocalPackRank(keyword, location, orgId);
      const resultCount = Array.isArray(rankings) ? rankings.length : 0;
      try {
        await finalizeRankingSearch(orgId, histId, rankings);
      } catch (persistErr) {
        logger.error({ err: persistErr, orgId, histId }, "[seo] local-seo ranking finalization failed");
        res.status(502).json({
          ok: false, rankings: [], configured: true, reason: "persist_error",
          error: "Le classement a été récupéré mais n'a pas pu être enregistré. Réessayez dans quelques instants.",
        });
        return;
      }
      const usage = { used: reservation.used, limit: reservation.limit };
      res.json({ ok: true, keyword, location, rankings, count: resultCount, configured: true, usage });
      return;
    }
    res.json({ ok: false, rankings: [], configured: false, reason: "not_configured",
      message: "Le service de classement local n'est pas encore configuré pour votre organisation." });
  } catch (e) {
    logger.error({ err: e, orgId }, "[seo] local-seo rankings provider error");
    res.status(502).json({ ok: false, rankings: [], configured: true, reason: "provider_error",
      error: "Le service de classement local est temporairement indisponible. Réessayez dans quelques instants." });
  }
});

// ── GET /local-seo/rankings/history ──────────────────────────────────────────
// Returns persisted ranking searches for this org (newest first, limit 50).
router.get("/local-seo/rankings/history", async (req, res) => {
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  try {
    const r = await pool.query(
      `SELECT id, keyword, location, results, searched_at
       FROM local_seo_ranking_history
       WHERE org_id=$1 AND jsonb_typeof(results)='array'
       ORDER BY searched_at DESC
       LIMIT 50`,
      [orgId]
    );
    // results is stored as JSONB — node-pg returns it parsed, but tolerate a
    // string (legacy rows / text column drift) so Array.isArray(h.results) works.
    const history = r.rows.map(row => {
      const results = typeof row.results === "string"
        ? (() => { try { return JSON.parse(row.results); } catch { return []; } })()
        : (Array.isArray(row.results) ? row.results : []);
      // Expose an explicit real result count so the frontend never has to guess.
      return { ...row, results, resultCount: results.length, total_results: results.length };
    });
    // Persisted usage — derived from real rows so it survives F5. `used` is
    // today's ranking searches, `limit` is the DataForSEO daily quota.
    const usage = await getRankingUsage(orgId);
    res.json({ ok: true, history, count: history.length, usage });
  } catch (err) {
    logger.error({ err, orgId }, "[seo] local-seo ranking history fetch failed");
    res.status(500).json({
      ok: false,
      reason: "history_unavailable",
      error: "Impossible de charger l'historique des classements locaux.",
    });
  }
});

router.get("/seo/llm-visibility", withQuota(async (req, res) => {
  const { domain = "exemple.fr", sector } = req.query as Record<string,string>;
  const orgId = (req as unknown as Record<string, unknown>)["orgId"] as string ?? "default";
  try {
    const data = await checkLLMVisibility(domain, sector, orgId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "LLM visibility check failed", detail: String(e) });
  }
}));

export default router;
