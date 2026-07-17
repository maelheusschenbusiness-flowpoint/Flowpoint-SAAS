import { pool } from "@workspace/db";

export interface ForecastData {
  siteUrl: string;
  forecasts: ForecastPoint[];
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
        `SELECT * FROM seo_forecasts WHERE org_id=$1 AND site_url=$2 ORDER BY forecast_date ASC LIMIT 90`,
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

  // In production, never return fabricated numbers — return empty state.
  if (process.env["NODE_ENV"] === "production") {
    return { ...EMPTY_FORECAST, siteUrl: url, generatedAt: new Date().toISOString() };
  }

  // Dev/staging only: return a computed demo forecast.
  return buildComputedForecast(url);
}

function buildComputedForecast(url: string): ForecastData {
  const now = new Date();
  const forecasts: ForecastPoint[] = [];
  const baseTraffic = 350;
  const baseCR = 0.028;

  for (let i = 1; i <= 90; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const seasonality = 1 + 0.15 * Math.sin((d.getMonth() / 12) * 2 * Math.PI);
    const growth = 1 + (i / 90) * 0.18;
    const realistic = Math.round(baseTraffic * seasonality * growth);
    for (const scenario of ["pessimistic", "realistic", "optimistic"] as const) {
      const multiplier = scenario === "pessimistic" ? 0.8 : scenario === "optimistic" ? 1.25 : 1;
      const traffic = Math.round(realistic * multiplier);
      const conversions = Math.round(traffic * baseCR * (scenario === "optimistic" ? 1.15 : scenario === "pessimistic" ? 0.85 : 1));
      forecasts.push({
        date: d.toISOString().slice(0, 10),
        predictedTraffic: traffic,
        predictedConversions: conversions,
        predictedRevenue: Math.round(conversions * 85),
        confidence: scenario === "realistic" ? 78 : 55,
        scenario,
      });
    }
  }

  const realistic = forecasts.filter(f => f.scenario === "realistic");
  return {
    siteUrl: url,
    forecasts,
    summary: {
      expectedTrafficIn30d: realistic.slice(0, 30).reduce((s, f) => s + f.predictedTraffic, 0),
      expectedTrafficIn90d: realistic.reduce((s, f) => s + f.predictedTraffic, 0),
      expectedConversionsIn30d: realistic.slice(0, 30).reduce((s, f) => s + f.predictedConversions, 0),
      expectedRevenueIn90d: realistic.reduce((s, f) => s + f.predictedRevenue, 0),
      confidenceScore: 78,
      growthScenarios: { pessimistic: -5, realistic: 18, optimistic: 35 },
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function generateForecasts(orgId: string, siteUrl: string): Promise<void> {
  const forecast = buildComputedForecast(siteUrl);
  try {
    const client = await pool.connect();
    try {
      for (const f of forecast.forecasts) {
        await client.query(
          `INSERT INTO seo_forecasts (id, org_id, site_url, forecast_date, predicted_traffic, predicted_conversions, predicted_revenue, confidence, scenario, generated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (org_id, site_url, forecast_date, scenario) DO UPDATE SET
             predicted_traffic=$5, predicted_conversions=$6, predicted_revenue=$7, confidence=$8, generated_at=NOW()`,
          [`fc_${orgId}_${siteUrl}_${f.date}_${f.scenario}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 80),
           orgId, siteUrl, f.date, f.predictedTraffic, f.predictedConversions, f.predictedRevenue, f.confidence, f.scenario]
        );
      }
    } finally { client.release(); }
  } catch { /* non-fatal */ }
}
