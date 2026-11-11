import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { requireAddon } from "../middlewares/planGate.js";
import { canWrite } from "../middlewares/requireRole.js";
import { deriveConversionObservations } from "../services/conversion-observations.js";
import { REVENUE_LEAK_ATTRIBUTION } from "../services/revenue-leak-attribution.js";
import { getGA4ConversionPages } from "../services/ga4-service.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);
const ISO_4217_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

const unavailableGA4Revenue = () => ({
  status: "unavailable",
  source: "ga4",
  observedRevenue: null,
  observedConversions: null,
  observedLoss: null,
  estimatedLoss: null,
  currency: null,
  note: "Connectez une propriété GA4 active avec une devise reconnue pour afficher le revenu observé. Aucune perte n’est estimée.",
});

function summarizeGA4Revenue(report: Awaited<ReturnType<typeof getGA4ConversionPages>>) {
  const metrics = report.totals?.[0]?.metricValues ?? [];
  const rawRevenue = String(metrics[3]?.value ?? "").trim();
  const revenue = rawRevenue ? Number(rawRevenue) : Number.NaN;
  const rawConversions = String(metrics[2]?.value ?? "").trim();
  const conversions = rawConversions ? Number(rawConversions) : Number.NaN;
  const currency = String(report.currencyCode ?? "").trim().toUpperCase();
  if (!Number.isFinite(revenue) || !ISO_4217_CURRENCIES.has(currency)) return unavailableGA4Revenue();
  return {
    status: "observed",
    source: "ga4",
    observedRevenue: revenue,
    observedConversions: Number.isFinite(conversions) ? conversions : null,
    observedLoss: null,
    estimatedLoss: null,
    currency,
    note: "Total GA4 des pages d’entrée sur les 30 derniers jours. Ce montant n’est pas attribué aux frictions listées.",
  };
}

async function loadGA4Revenue(req: Request, siteUrl?: string) {
  const orgId = (req as OrgReq).orgId ?? "default";
  if (siteUrl) {
    try {
      const { rows } = await db(req)(
        `SELECT website_url AS "websiteUrl"
           FROM ga4_properties
          WHERE org_id = $1 AND is_active = true
          LIMIT 1`,
        [orgId],
      );
      const siteHost = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
      const propertyHost = new URL(String(rows[0]?.websiteUrl ?? "")).hostname.toLowerCase().replace(/^www\./, "");
      if (!siteHost || siteHost !== propertyHost) return unavailableGA4Revenue();
    } catch {
      return unavailableGA4Revenue();
    }
  }

  try {
    // This is the completed 30-day aggregate period; today's partial data is excluded.
    return summarizeGA4Revenue(await getGA4ConversionPages(orgId, "30daysAgo", "yesterday"));
  } catch {
    return unavailableGA4Revenue();
  }
}

const unavailableGA4Revenue = () => ({
  status: "unavailable",
  source: "ga4",
  observedRevenue: null,
  observedConversions: null,
  observedLoss: null,
  estimatedLoss: null,
  currency: null,
  note: "Connectez une propriété GA4 active avec une devise reconnue pour afficher le revenu observé. Aucune perte n’est estimée.",
});

function summarizeGA4Revenue(report: Awaited<ReturnType<typeof getGA4ConversionPages>>) {
  const metrics = report.totals?.[0]?.metricValues ?? [];
  const revenue = Number(metrics[3]?.value);
  const conversions = Number(metrics[2]?.value);
  const currency = String(report.currencyCode ?? "").trim().toUpperCase();
  if (!Number.isFinite(revenue) || !/^[A-Z]{3}$/.test(currency)) return unavailableGA4Revenue();
  return {
    status: "observed",
    source: "ga4",
    observedRevenue: revenue,
    observedConversions: Number.isFinite(conversions) ? conversions : null,
    observedLoss: null,
    estimatedLoss: null,
    currency,
    note: "Total GA4 des pages d’entrée sur les 30 derniers jours. Ce montant n’est pas attribué aux frictions listées.",
  };
}

async function loadGA4Revenue(req: Request, siteUrl?: string) {
  const orgId = (req as OrgReq).orgId ?? "default";
  if (siteUrl) {
    try {
      const { rows } = await db(req)(
        `SELECT website_url AS "websiteUrl"
           FROM ga4_properties
          WHERE org_id = $1 AND is_active = true
          LIMIT 1`,
        [orgId],
      );
      const siteHost = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
      const propertyHost = new URL(String(rows[0]?.websiteUrl ?? "")).hostname.toLowerCase().replace(/^www\./, "");
      if (!siteHost || siteHost !== propertyHost) return unavailableGA4Revenue();
    } catch {
      return unavailableGA4Revenue();
    }
  }

  try {
    // This is the completed 30-day aggregate period; today's partial data is excluded.
    return summarizeGA4Revenue(await getGA4ConversionPages(orgId, "30daysAgo", "yesterday"));
  } catch {
    return unavailableGA4Revenue();
  }
}

// Gate scoped to /revenue-leak/* only — path-less router.use() would intercept every route
// mounted after this router in index.ts (same catch-all pattern as behavioral.ts).
router.use("/revenue-leak", requireAddon("revenueLeak", "Revenue Leak AI"));

async function loadRevenueOpportunities(req: Request, siteUrl?: string) {
  const orgId = (req as OrgReq).orgId ?? "default";
  const params: unknown[] = [orgId];
  let siteClause = "";
  if (siteUrl) {
    params.push(siteUrl);
    siteClause = " AND site_url = $2";
  }
  const { rows } = await db(req)(
    `SELECT site_url AS "siteUrl", page, session_id AS "sessionId", event_type AS "eventType",
            scroll_depth AS "scrollDepth"
       FROM behavior_events
      WHERE org_id = $1${siteClause}
        AND created_at >= now() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 20000`,
    params,
  );
  const observations = deriveConversionObservations(rows).map((observation) => {
    const observedSite = observation.siteUrl ?? siteUrl ?? null;
    const id = createHash("sha256")
      .update(`${orgId}|${observedSite ?? ""}|${observation.page}|${observation.eventType}`)
      .digest("hex");
    return { ...observation, id, siteUrl: observedSite };
  });
  const resolutionRows = await db(req)(
    `SELECT id, resolved_observed_events AS "resolvedObservedEvents",
            resolved_affected_sessions AS "resolvedAffectedSessions"
       FROM revenue_leak_resolutions
      WHERE org_id = $1`,
    [orgId],
  );
  const resolutions = new Map(resolutionRows.rows.map((row) => [
    String(row.id),
    {
      events: Number(row.resolvedObservedEvents) || 0,
      sessions: Number(row.resolvedAffectedSessions) || 0,
    },
  ]));
  return observations
    .filter((observation) => {
      const resolved = resolutions.get(observation.id);
      return !resolved ||
        observation.observedEvents > resolved.events ||
        observation.affectedSessions > resolved.sessions;
    })
    .map((observation) => ({
      ...observation,
      kind: "conversion_opportunity",
      financialClassification: "unmeasured",
      observedRevenueLoss: null,
      estimatedRevenueLoss: null,
      note: "Événements observés; aucune donnée de revenu reliée à ces événements.",
    }));
}

async function assertSiteOwnership(req: OrgReq, siteUrl: string, res: Response): Promise<boolean> {
  const orgId = req.orgId ?? "default";
  try {
    const { rows } = await req.orgDb(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
      [orgId, siteUrl]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Site not found" });
      return false;
    }
    return true;
  } catch {
    // A scoped lookup failure is not evidence that the site is missing.
    // Return the same generic service error for DB and other infrastructure
    // failures without disclosing whether a site exists in another org.
    res.status(503).json({ error: "Site ownership could not be verified. Please retry." });
    return false;
  }
}

router.get("/revenue-leak", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    if (siteUrl) {
      const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
      if (!owned) return;
    }
    const opportunities = await loadRevenueOpportunities(req, siteUrl);
    res.json({
      ok: true, source: "behavior_events", windowDays: 30, opportunities,
      observations: opportunities.map(({ siteUrl, page, eventType, observedEvents, affectedSessions, confidence }) =>
        ({ siteUrl, page, eventType, observedEvents, affectedSessions, confidence })),
      attribution: REVENUE_LEAK_ATTRIBUTION,
      financial: await loadGA4Revenue(req, siteUrl),
      noData: opportunities.length === 0,
    });
  } catch {
    res.status(503).json({
      error: "Les événements comportementaux sont temporairement indisponibles.",
      opportunities: [],
      attribution: REVENUE_LEAK_ATTRIBUTION,
      financial: unavailableGA4Revenue(),
      noData: true,
    });
  }
});

router.post("/revenue-leak/detect", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
  if (!owned) return;
  try {
    const opportunities = await loadRevenueOpportunities(req, siteUrl);
    res.json({
      ok: true, source: "behavior_events", windowDays: 30, opportunities,
      attribution: REVENUE_LEAK_ATTRIBUTION,
      financial: await loadGA4Revenue(req, siteUrl),
      noData: opportunities.length === 0,
    });
  } catch {
    res.status(500).json({
      error: "Failed to detect revenue leaks",
      attribution: REVENUE_LEAK_ATTRIBUTION,
      financial: unavailableGA4Revenue(),
    });
  }
});

router.patch("/revenue-leak/:id/resolve", canWrite, async (req: Request, res: Response) => {
  const { id } = req.params;
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    const opportunity = (await loadRevenueOpportunities(req)).find((item) => item.id === id);
    if (!opportunity) { res.status(404).json({ error: "Opportunity not found" }); return; }
    const result = await db(req)(
      `INSERT INTO revenue_leak_resolutions (
         id, org_id, site_url, page, event_type,
         resolved_observed_events, resolved_affected_sessions, resolved_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (id) DO UPDATE SET
         site_url = EXCLUDED.site_url,
         page = EXCLUDED.page,
         event_type = EXCLUDED.event_type,
         resolved_observed_events = EXCLUDED.resolved_observed_events,
         resolved_affected_sessions = EXCLUDED.resolved_affected_sessions,
         resolved_at = now()
       WHERE revenue_leak_resolutions.org_id = EXCLUDED.org_id
       RETURNING id`,
      [
        opportunity.id,
        orgId,
        opportunity.siteUrl ?? "",
        opportunity.page,
        opportunity.eventType,
        opportunity.observedEvents,
        opportunity.affectedSessions,
      ],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Opportunity not found" }); return; }
    res.json({ ok: true, id: opportunity.id });
  } catch {
    res.status(500).json({ error: "Failed to resolve leak" });
  }
});

export default router;
