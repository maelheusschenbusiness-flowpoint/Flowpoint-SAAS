import { pool } from "@workspace/db";
import { getGA4ForecastHistory } from "./ga4-service.js";

export interface ForecastData {
  siteUrl: string;
  forecasts: ForecastPoint[];
  available: boolean;
  status: "available" | "insufficient_data";
  minimumHistoryDays: number;
  ga4Available: boolean;
  source: "gsc" | "gsc+ga4" | "stored" | "none";
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

export function projectGA4DailyMetric(
  values: number[],
  day: number,
  multiplier: number,
  precision = 0,
): number {
  if (values.length < MINIMUM_HISTORY_DAYS || values.some(value => !Number.isFinite(value) || value < 0)) return 0;
  const recent = values.slice(-14);
  const previous = values.slice(-28, -14);
  const average = (series: number[]) => series.length ? series.reduce((sum, value) => sum + value, 0) / series.length : 0;
  const baseline = average(recent);
  const previousAverage = average(previous);
  const trend = previous.length
    ? Math.max(-0.05, Math.min(0.05, (baseline - previousAverage) / Math.max(previousAverage, 1) / 14))
    : 0;
  const scale = 10 ** precision;
  return Math.max(0, Math.round(baseline * Math.pow(1 + trend, day) * multiplier * scale) / scale);
}

function isValidForecastDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function storedNumber(value: unknown): number {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return Number.NaN;
  }
  return Number(value);
}

// A forecast requires at least 14 measured daily observations from both
// Google Search Console and GA4. Zero is valid only when it was explicitly
// returned as a measured value by the source; missing/invalid values are not.
export const MINIMUM_HISTORY_DAYS = 14;

const EMPTY_FORECAST: ForecastData = {
  siteUrl: "",
  forecasts: [],
  available: false,
  status: "insufficient_data",
  minimumHistoryDays: MINIMUM_HISTORY_DAYS,
  ga4Available: false,
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
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM seo_forecasts
       WHERE org_id=$1 AND site_url=$2 AND source='gsc+ga4'
       ORDER BY forecast_date ASC, scenario ASC LIMIT 270`,
      [orgId, url]
    );
    if (res.rows.length > 0) {
      const forecasts: ForecastPoint[] = res.rows.map((r: Record<string, unknown>) => ({
        date: String(r["forecast_date"]),
        predictedTraffic: storedNumber(r["predicted_traffic"]),
        predictedConversions: storedNumber(r["predicted_conversions"]),
        predictedRevenue: storedNumber(r["predicted_revenue"]),
        confidence: storedNumber(r["confidence"]),
        scenario: String(r["scenario"]) as ForecastPoint["scenario"],
      }));
      const validScenarios = new Set<ForecastPoint["scenario"]>(["pessimistic", "realistic", "optimistic"]);
      if (forecasts.some(point =>
        !isValidForecastDate(point.date)
        || !validScenarios.has(point.scenario)
        || ![point.predictedTraffic, point.predictedConversions, point.predictedRevenue]
          .every(value => Number.isFinite(value) && value >= 0)
        || !Number.isFinite(point.confidence)
        || point.confidence < 0
        || point.confidence > 100
      )) {
        return {
          ...EMPTY_FORECAST,
          siteUrl: url,
          generatedAt: new Date().toISOString(),
          reason: "Les prévisions enregistrées contiennent des métriques invalides.",
        };
      }
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
        status: realistic.length > 0 ? "available" : "insufficient_data",
        minimumHistoryDays: MINIMUM_HISTORY_DAYS,
        ga4Available: res.rows.some((r: Record<string, unknown>) => r["source"] === "gsc+ga4"),
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
    const measuredClicks = history.rows.map(r => r.clicks == null ? Number.NaN : Number(r.clicks));
    if (history.rows.length < MINIMUM_HISTORY_DAYS
      || measuredClicks.some(value => !Number.isFinite(value) || value < 0)) {
      return { ...EMPTY_FORECAST, siteUrl, generatedAt: new Date().toISOString(),
        reason: `Au moins ${MINIMUM_HISTORY_DAYS} jours de données Google Search Console valides sont nécessaires.` };
    }
    const ga4History = await getGA4ForecastHistory(orgId, "35daysAgo", "yesterday").catch(() => null);
    const measuredGa4 = (ga4History ?? []).filter((row): row is {
      date: string;
      sessions: number;
      conversions: number;
      revenue: number;
    } => {
      const day = new Date(`${row.date}T00:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        && Number.isFinite(day.getTime())
        && day.toISOString().slice(0, 10) === row.date
        && [row.sessions, row.conversions, row.revenue].every(value =>
          typeof value === "number" && Number.isFinite(value) && value >= 0);
    });
    const distinctGa4Days = new Set(measuredGa4.map(row => row.date));
    if (distinctGa4Days.size < MINIMUM_HISTORY_DAYS) {
      return {
        ...EMPTY_FORECAST,
        siteUrl,
        generatedAt: new Date().toISOString(),
        reason: `Au moins ${MINIMUM_HISTORY_DAYS} jours de données GA4 valides (sessions, conversions et revenus mesurés) sont nécessaires.`,
      };
    }
    const uniqueGa4 = measuredGa4.filter((row, index, rows) =>
      rows.findIndex(candidate => candidate.date === row.date) === index
    );
    const ga4Conversions = uniqueGa4.map(row => row.conversions);
    const ga4Revenue = uniqueGa4.map(row => row.revenue);
    const clicks = measuredClicks;
    const recent = clicks.slice(-14);
    const previous = clicks.slice(-28, -14);
    const baseline = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const previousAverage = previous.length ? previous.reduce((sum, value) => sum + value, 0) / previous.length : baseline;
    const dailyTrend = Math.max(-0.05, Math.min(0.05, (baseline - previousAverage) / Math.max(previousAverage, 1) / 14));
    const confidence = Math.min(85, 45 + Math.min(history.rows.length, uniqueGa4.length));
    const forecasts: ForecastPoint[] = [];
    const multipliers = { pessimistic: 0.9, realistic: 1, optimistic: 1.1 } as const;
    for (let day = 1; day <= 90; day++) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + day);
      for (const scenario of Object.keys(multipliers) as ForecastPoint["scenario"][]) {
        const traffic = Math.max(0, Math.round(baseline * Math.pow(1 + dailyTrend, day) * multipliers[scenario]));
        forecasts.push({ date: date.toISOString().slice(0, 10), predictedTraffic: traffic,
          predictedConversions: projectGA4DailyMetric(ga4Conversions, day, multipliers[scenario]),
          predictedRevenue: projectGA4DailyMetric(ga4Revenue, day, multipliers[scenario], 2),
          confidence, scenario });
      }
    }
    let txActive = false;
    try {
      await client.query("BEGIN");
      txActive = true;
      for (const f of forecasts) {
        await client.query(
          `INSERT INTO seo_forecasts (id, org_id, site_url, forecast_date, predicted_traffic, predicted_conversions, predicted_revenue, confidence, scenario, source, generated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (org_id, site_url, forecast_date, scenario) DO UPDATE SET
             predicted_traffic=$5, predicted_conversions=$6, predicted_revenue=$7, confidence=$8, source=$10, generated_at=NOW()`,
          [`fc_${orgId}_${siteUrl}_${f.date}_${f.scenario}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 80),
            orgId, siteUrl, f.date, f.predictedTraffic, f.predictedConversions, f.predictedRevenue,
            f.confidence, f.scenario, "gsc+ga4"]
        );
      }
      await client.query("COMMIT");
      txActive = false;
    } catch (error) {
      if (txActive) {
        await client.query("ROLLBACK").catch(() => {});
        txActive = false;
      }
      throw error;
    }
    const data = await getForecastData({ orgId, siteUrl });
    return {
      ...data,
      available: true,
      status: "available",
      minimumHistoryDays: MINIMUM_HISTORY_DAYS,
      ga4Available: true,
      source: "gsc+ga4",
      reason: `Prévisions issues des données mesurées GSC et GA4; minimum requis : ${MINIMUM_HISTORY_DAYS} jours valides.`,
    };
  } finally { client.release(); }
}
