import { Router } from "express";
import { logger } from "../lib/logger.js";
import {
  analyzePSI,
  getPSIHistory,
  getLatestPSIResult,
  invalidatePSICache,
} from "../services/pagespeed-service.js";
import { consumeAICredits } from "../services/ai-engine.js";

// ── SSRF protection ────────────────────────────────────────────────────────────
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "broadcasthost", "metadata.google.internal", "169.254.169.254",
]);
const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1|fc|fd)/i;

function rejectInternalUrl(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(url);
    if (!["http:", "https:"].includes(protocol)) return "Only http/https URLs are allowed";
    const h = hostname.replace(/^\[|\]$/g, "");
    if (BLOCKED_HOSTNAMES.has(h.toLowerCase())) return "URL targets a blocked hostname";
    if (PRIVATE_IP_RE.test(h)) return "URL targets a private or internal IP address";
    return null;
  } catch {
    return "Invalid URL";
  }
}

// Helper: always read orgId from the auth middleware, never trust body/query.
function getOrgId(req: unknown): string {
  return (req as { orgId?: string }).orgId ?? "default";
}

const router = Router();

// ── In-progress analysis guard (prevent duplicate concurrent calls) ────────────
const inProgress = new Set<string>();

// ── POST /api/pagespeed/analyze — full mobile + desktop analysis ───────────────
router.post("/pagespeed/analyze", async (req, res) => {
  const { url, force = false } = req.body as {
    url?: string;
    force?: boolean;
  };
  const orgId = getOrgId(req);

  if (!url) {
    res.status(400).json({ error: "url requis" });
    return;
  }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }

  const key = `${orgId}:${normalizedUrl}`;

  if (inProgress.has(key)) {
    res.status(409).json({ error: "Analyse déjà en cours pour cette URL" });
    return;
  }

  // Credit check
  const creditCheck = await consumeAICredits({ feature: "behavior_analysis", orgId });
  if (!creditCheck.allowed) {
    res.status(402).json({ error: "Crédits IA insuffisants pour lancer une analyse PageSpeed" });
    return;
  }

  inProgress.add(key);
  try {
    logger.info({ url: normalizedUrl, orgId, force }, "[PSI] Starting full analysis");

    const [mobile, desktop] = await Promise.all([
      analyzePSI(normalizedUrl, "mobile", orgId, force),
      analyzePSI(normalizedUrl, "desktop", orgId, force),
    ]);

    res.json({
      url: normalizedUrl,
      analyzedAt: new Date().toISOString(),
      mobile,
      desktop,
      creditsRemaining: creditCheck.remaining,
    });
  } catch (err) {
    logger.error({ err, url: normalizedUrl }, "[PSI] Analysis failed");
    res.status(500).json({
      error: "Échec de l'analyse PageSpeed — vérifiez que l'URL est accessible publiquement",
      details: (err as Error).message,
    });
  } finally {
    inProgress.delete(key);
  }
});

// ── GET /api/pagespeed/mobile — mobile-only analysis ─────────────────────────
router.get("/pagespeed/mobile", async (req, res) => {
  const { url, force } = req.query as Record<string, string>;
  const orgId = getOrgId(req);

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }

  try {
    const result = await analyzePSI(normalizedUrl, "mobile", orgId, force === "true");
    res.json(result);
  } catch (err) {
    logger.error({ err, url: normalizedUrl }, "[PSI] Mobile analysis failed");
    res.status(500).json({ error: "Échec analyse mobile", details: (err as Error).message });
  }
});

// ── GET /api/pagespeed/desktop — desktop-only analysis ───────────────────────
router.get("/pagespeed/desktop", async (req, res) => {
  const { url, force } = req.query as Record<string, string>;
  const orgId = getOrgId(req);

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }

  try {
    const result = await analyzePSI(normalizedUrl, "desktop", orgId, force === "true");
    res.json(result);
  } catch (err) {
    logger.error({ err, url: normalizedUrl }, "[PSI] Desktop analysis failed");
    res.status(500).json({ error: "Échec analyse desktop", details: (err as Error).message });
  }
});

// ── GET /api/pagespeed/history — historical scores ────────────────────────────
router.get("/pagespeed/history", async (req, res) => {
  const {
    url,
    strategy = "mobile",
    days = "30",
  } = req.query as Record<string, string>;
  const orgId = getOrgId(req);

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }

  const daysNum = Math.min(Math.max(Number(days) || 30, 1), 365);

  try {
    const history = await getPSIHistory(
      normalizedUrl,
      strategy as "mobile" | "desktop",
      orgId,
      daysNum
    );
    res.json({ url: normalizedUrl, strategy, days: daysNum, history });
  } catch (err) {
    logger.error({ err }, "[PSI] History fetch failed");
    res.status(500).json({ error: "Erreur récupération historique" });
  }
});

// ── GET /api/pagespeed/opportunities — latest opportunities ───────────────────
router.get("/pagespeed/opportunities", async (req, res) => {
  const {
    url,
    strategy = "mobile",
    category,
  } = req.query as Record<string, string>;
  const orgId = getOrgId(req);

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }

  try {
    // Try DB first (avoid re-fetching)
    const latest = await getLatestPSIResult(
      normalizedUrl,
      strategy as "mobile" | "desktop",
      orgId
    );

    let opportunities: unknown[] = [];

    if (latest) {
      opportunities = (latest.opportunities as unknown[]) ?? [];
    } else {
      // Fetch fresh
      const result = await analyzePSI(normalizedUrl, strategy as "mobile" | "desktop", orgId);
      opportunities = result.opportunities;
    }

    // Filter by category if requested
    if (category && category !== "all") {
      opportunities = (opportunities as Array<Record<string, unknown>>).filter(
        o => o.category === category
      );
    }

    res.json({ url: normalizedUrl, strategy, opportunities, total: opportunities.length });
  } catch (err) {
    logger.error({ err }, "[PSI] Opportunities fetch failed");
    res.status(500).json({ error: "Erreur récupération opportunités" });
  }
});

// ── POST /api/pagespeed/compare — before/after comparison ────────────────────
router.post("/pagespeed/compare", async (req, res) => {
  const { url } = req.body as { url?: string };
  const orgId = getOrgId(req);

  if (!url) { res.status(400).json({ error: "url requis" }); return; }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }

  try {
    const [mobileHistory, desktopHistory] = await Promise.all([
      getPSIHistory(normalizedUrl, "mobile", orgId, 90),
      getPSIHistory(normalizedUrl, "desktop", orgId, 90),
    ]);

    const firstMobile = mobileHistory[0];
    const lastMobile = mobileHistory[mobileHistory.length - 1];
    const firstDesktop = desktopHistory[0];
    const lastDesktop = desktopHistory[desktopHistory.length - 1];

    const delta = (a: number | undefined, b: number | undefined) =>
      a !== undefined && b !== undefined ? Math.round(b - a) : null;

    res.json({
      url: normalizedUrl,
      mobile: {
        first: firstMobile,
        last: lastMobile,
        delta: firstMobile && lastMobile ? {
          performance:    delta(firstMobile.performance,   lastMobile.performance),
          accessibility:  delta(firstMobile.accessibility, lastMobile.accessibility),
          seo:            delta(firstMobile.seo,           lastMobile.seo),
          bestPractices:  delta(firstMobile.bestPractices, lastMobile.bestPractices),
          lcp:            delta(firstMobile.lcp,           lastMobile.lcp),
        } : null,
        dataPoints: mobileHistory.length,
      },
      desktop: {
        first: firstDesktop,
        last: lastDesktop,
        delta: firstDesktop && lastDesktop ? {
          performance:    delta(firstDesktop.performance,   lastDesktop.performance),
          accessibility:  delta(firstDesktop.accessibility, lastDesktop.accessibility),
          seo:            delta(firstDesktop.seo,           lastDesktop.seo),
        } : null,
        dataPoints: desktopHistory.length,
      },
    });
  } catch (err) {
    logger.error({ err }, "[PSI] Compare failed");
    res.status(500).json({ error: "Erreur comparaison" });
  }
});

// ── DELETE /api/pagespeed/cache — invalidate cache for URL ───────────────────
router.delete("/pagespeed/cache", (req, res) => {
  const { url } = req.query as Record<string, string>;
  const orgId = getOrgId(req);
  if (!url) { res.status(400).json({ error: "url requis" }); return; }
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const ssrfError = rejectInternalUrl(normalizedUrl);
  if (ssrfError) { res.status(400).json({ error: ssrfError }); return; }
  invalidatePSICache(normalizedUrl, orgId);
  res.json({ invalidated: true, url: normalizedUrl });
});

export default router;
