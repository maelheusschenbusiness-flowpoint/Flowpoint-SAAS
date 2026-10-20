import { pool } from "@workspace/db";

export interface ForecastData {
  siteUrl: string;
  forecasts: ForecastPoint[];
  available: boolean;
  source: "gsc" | "stored" | "none";
  reason?: string;
  summary: {
    expectedTrafficIn30d: number;
    expectedTrafficIn90d: number;
    expectedConversionsIn30d: number;
    expectedRevenueIn90d: number;
    confidenceScore: number;
    growthScenarios: { pessimistic: number; realistic: number; optimistic: number };
  };
  generatedAt: string;
}

export interface ForecastPoint {
  date: string;
  predictedTraffic: number;
  predictedConversions: number;
  predictedRevenue: number;
  confidence: number;
  scenario: "pessimistic" | "realistic" | "optimistic";
}

const EMPTY_FORECAST: ForecastData = {
  siteUrl: "",
  forecasts: [],
  available: false,
  source: "none",
  reason: "Données historiques insuffisantes pour générer une prévision.",
  summary: {
    expectedTrafficIn30d: 0,
    expectedTrafficIn90d: 0,
    expectedConversionsIn30d: 0,
    expectedRevenueIn90d: 0,
    confidenceScore: 0,
    growthScenarios: { pessimistic: 0, realistic: 0, optimistic: 0 },
  },
  generatedAt: new Date().toISOString(),
};

export interface GetForecastParams {
  orgId: string;
  siteUrl?: string;
}

/**
 * Fetch forecast data scoped to the given organisation.
 * orgId is always required — never rely on site_url alone for tenant isolation.
 */
export async function getForecastData({ orgId, siteUrl }: GetForecastParams): Promise<ForecastData> {
  const url = siteUrl ?? "default";
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT * FROM seo_forecasts
         WHERE org_id=$1 AND site_url=$2 AND source='gsc'
         ORDER BY forecast_date ASC, scenario ASC LIMIT 270`,
        [orgId, url]
      );
      if (res.rows.length > 0) {
        const forecasts: ForecastPoint[] = res.rows.map((r: Record<string, unknown>) => ({
          date: String(r["forecast_date"]),
          predictedTraffic: Number(r["predicted_traffic"] ?? 0),
          predictedConversions: Number(r["predicted_conversions"] ?? 0),
          predictedRevenue: Number(r["predicted_revenue"] ?? 0),
          confidence: Number(r["confidence"] ?? 75),
          scenario: String(r["scenario"] ?? "realistic") as ForecastPoint["scenario"],
        }));
        const realistic = forecasts.filter(f => f.scenario === "realistic");
        const in30 = realistic.slice(0, 30);
        const in90 = realistic.slice(0, 90);
        const realTraffic30  = in30.reduce((s, f) => s + f.predictedTraffic, 0);
        const realTraffic90  = in90.reduce((s, f) => s + f.predictedTraffic, 0);
        const prev30 = realistic.slice(30, 60).reduce((s, f) => s + f.predictedTraffic, 0);
        const growthPct = prev30 > 0 ? Math.round(((realTraffic30 - prev30) / prev30) * 100) : 0;
        return {
          siteUrl: url,
          forecasts,
          available: realistic.length > 0,
          source: "stored",
          summary: {
            expectedTrafficIn30d:     realTraffic30,
            expectedTrafficIn90d:     realTraffic90,
            expectedConversionsIn30d: in30.reduce((s, f) => s + f.predictedConversions, 0),
            expectedRevenueIn90d:     in90.reduce((s, f) => s + f.predictedRevenue, 0),
            confidenceScore: Math.round(
              realistic.slice(0, 30).reduce((s, f) => s + f.confidence, 0) / Math.max(in30.length, 1)
            ),
            growthScenarios: { pessimistic: Math.round(growthPct * 0.6), realistic: growthPct, optimistic: Math.round(growthPct * 1.4) },
          },
          generatedAt: new Date().toISOString(),
        };
      }
    } finally { client.release(); }
  } catch { /* non-fatal */ }

  // A forecast is a business decision aid: never fabricate one in any environment.
  return { ...EMPTY_FORECAST, siteUrl: url, generatedAt: new Date().toISOString() };
}

export async function generateForecasts(orgId: string, siteUrl: string): Promise<ForecastData> {
  const client = await pool.connect();
  try {
    const activeSite = await client.query(
      `SELECT site_url FROM gsc_sites WHERE org_id=$1 AND is_active=true LIMIT 1`,
      [orgId]
    );
    const gscSiteUrl = String(activeSite.rows[0]?.site_url || "");
    if (!gscSiteUrl || gscSiteUrl !== siteUrl) {
      return {
        ...EMPTY_FORECAST,
        siteUrl,
        generatedAt: new Date().toISOString(),
        reason: gscSiteUrl
          ? "Sélectionnez le site actuellement actif dans Google Search Console pour générer une prévision."
          : "Aucun site Google Search Console actif n’est disponible pour générer une prévision.",
      };
    }
    const history = await client.query(
      `SELECT date::date AS date, SUM(clicks)::int AS clicks
       FROM gsc_keyword_data
       WHERE org_id=$1 AND date >= CURRENT_DATE - INTERVAL '35 days'
       GROUP BY date ORDER BY date ASC`,
      [orgId]
    );
    if (history.rows.length < 14) {
      return { ...EMPTY_FORECAST, siteUrl, generatedAt: new Date().toISOString(),
        reason: "Au moins 14 jours de données Google Search Console sont nécessaires." };
    }
    const clicks = history.rows.map(r => Number(r.clicks) || 0);
    const recent = clicks.slice(-14);
    const previous = clicks.slice(-28, -14);
    const baseline = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const previousAverage = previous.length ? previous.reduce((sum, value) => sum + value, 0) / previous.length : baseline;
    const dailyTrend = Math.max(-0.05, Math.min(0.05, (baseline - previousAverage) / Math.max(previousAverage, 1) / 14));
    const confidence = Math.min(85, 45 + history.rows.length);
    const forecasts: ForecastPoint[] = [];
    const multipliers = { pessimistic: 0.9, realistic: 1, optimistic: 1.1 } as const;
    for (let day = 1; day <= 90; day++) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + day);
      for (const scenario of Object.keys(multipliers) as ForecastPoint["scenario"][]) {
        const traffic = Math.max(0, Math.round(baseline * Math.pow(1 + dailyTrend, day) * multipliers[scenario]));
        forecasts.push({ date: date.toISOString().slice(0, 10), predictedTraffic: traffic,
          predictedConversions: 0, predictedRevenue: 0, confidence, scenario });
      }
    }
    for (const f of forecasts) {
      await client.query(
        `INSERT INTO seo_forecasts (id, org_id, site_url, forecast_date, predicted_traffic, predicted_conversions, predicted_revenue, confidence, scenario, source, generated_at)
           VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,'gsc',NOW())
         ON CONFLICT (org_id, site_url, forecast_date, scenario) DO UPDATE SET
           predicted_traffic=$5, predicted_conversions=0, predicted_revenue=0, confidence=$6, source='gsc', generated_at=NOW()`,
        [`fc_${orgId}_${siteUrl}_${f.date}_${f.scenario}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 80),
          orgId, siteUrl, f.date, f.predictedTraffic, f.confidence, f.scenario]
      );
    }
    const data = await getForecastData({ orgId, siteUrl });
    return { ...data, available: true, source: "gsc", reason: "Trafic projeté à partir des clics Google Search Console. Conversion et revenu nécessitent GA4." };
  } finally { client.release(); }
}
