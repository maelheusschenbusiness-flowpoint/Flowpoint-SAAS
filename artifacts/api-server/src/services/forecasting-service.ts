import { pool } from "@workspace/db";
import { stableId } from "../lib/stable-id.js";

export interface ForecastData {
  siteUrl: string;
  forecasts: ForecastPoint[];
  available: boolean;
  /**
   * Conversions / revenue ne sont mesures que par GA4. Sans GA4 (cas de toutes les previsions actuelles, issues de GSC),
   * ils sont `null` + flag `false` : jamais un zero qui passerait pour une mesure.
   */
  conversionsAvailable: boolean;
  revenueAvailable: boolean;
  source: "gsc" | "stored" | "none";
  reason?: string;
  summary: {
    expectedTrafficIn30d: number;
    expectedTrafficIn90d: number;
    expectedConversionsIn30d: number | null;
    expectedRevenueIn90d: number | null;
    confidenceScore: number;
    growthScenarios: { pessimistic: number; realistic: number; optimistic: number };
  };
  generatedAt: string;
}

/**
 * Sources de lignes dont conversions/revenue sont MESURES (donnees GA4). Aucune pour l'instant : les lignes
 * `source='gsc'` stockent 0 (colonnes NOT NULL DEFAULT 0, conservees pour ne pas migrer) qui ne signifie pas "mesure a zero".
 * La disponibilite est donc derivee de la source, pas de la valeur stockee.
 */
const CONVERSION_MEASURED_SOURCES: readonly string[] = [];
const REVENUE_MEASURED_SOURCES: readonly string[] = [];

export interface ForecastPoint {
  date: string;
  predictedTraffic: number;
  predictedConversions: number | null;
  predictedRevenue: number | null;
  confidence: number;
  scenario: "pessimistic" | "realistic" | "optimistic";
}

const EMPTY_FORECAST: ForecastData = {
  siteUrl: "",
  forecasts: [],
  available: false,
  conversionsAvailable: false,
  revenueAvailable: false,
  source: "none",
  reason: "Données historiques insuffisantes pour générer une prévision.",
  summary: {
    expectedTrafficIn30d: 0,
    expectedTrafficIn90d: 0,
    expectedConversionsIn30d: null,
    expectedRevenueIn90d: null,
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
         AND forecast_date >= (NOW() AT TIME ZONE 'UTC')::date
         ORDER BY forecast_date ASC, scenario ASC LIMIT 270`,
        [orgId, url]
      );
      if (res.rows.length > 0) {
        const forecasts: ForecastPoint[] = res.rows.map((r: Record<string, unknown>) => ({
          date: String(r["forecast_date"]),
          predictedTraffic: Number(r["predicted_traffic"] ?? 0),
          predictedConversions: CONVERSION_MEASURED_SOURCES.includes(String(r["source"] ?? ""))
            && r["predicted_conversions"] != null ? Number(r["predicted_conversions"]) : null,
          predictedRevenue: REVENUE_MEASURED_SOURCES.includes(String(r["source"] ?? ""))
            && r["predicted_revenue"] != null ? Number(r["predicted_revenue"]) : null,
          confidence: Number(r["confidence"] ?? 75),
          scenario: String(r["scenario"] ?? "realistic") as ForecastPoint["scenario"],
        }));
        // Defence in depth: the read already floors forecast_date at the current UTC day,
        // but a row left over from an earlier generation must never count as a first day.
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = forecasts.filter(point => point.date.slice(0, 10) >= today);
        if (upcoming.length === 0) {
          return { ...EMPTY_FORECAST, siteUrl: url, generatedAt: new Date().toISOString() };
        }
        const realistic = upcoming.filter(f => f.scenario === "realistic");
        const in30 = realistic.slice(0, 30);
        const in90 = realistic.slice(0, 90);
        const realTraffic30  = in30.reduce((s, f) => s + f.predictedTraffic, 0);
        const realTraffic90  = in90.reduce((s, f) => s + f.predictedTraffic, 0);
        // Days 31-60 are further in the future than days 1-30: growth is measured forwards,
        // (days 31-60 - days 1-30) / days 1-30. Fewer than 60 days or a first month
        // without traffic means no measurable growth (0), never NaN/Infinity.
        const secondMonthTraffic = realistic.slice(30, 60).reduce((s, f) => s + f.predictedTraffic, 0);
        const growthPct = realistic.length >= 60 && realTraffic30 > 0
          ? Math.round(((secondMonthTraffic - realTraffic30) / realTraffic30) * 100)
          : 0;
        const conversionsAvailable = in30.length > 0 && in30.every(f => f.predictedConversions !== null);
        const revenueAvailable = in90.length > 0 && in90.every(f => f.predictedRevenue !== null);
        return {
          siteUrl: url,
          forecasts: upcoming,
          available: realistic.length > 0,
          conversionsAvailable,
          revenueAvailable,
          source: "stored",
          summary: {
            expectedTrafficIn30d:     realTraffic30,
            expectedTrafficIn90d:     realTraffic90,
            expectedConversionsIn30d: conversionsAvailable ? in30.reduce((s, f) => s + (f.predictedConversions ?? 0), 0) : null,
            expectedRevenueIn90d:     revenueAvailable ? in90.reduce((s, f) => s + (f.predictedRevenue ?? 0), 0) : null,
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

/** Fixed-length unique id of a forecast row (no truncation, no collision on long URLs). */
export function forecastRowId(orgId: string, siteUrl: string, date: string, scenario: string): string {
  return stableId("fc", orgId, siteUrl, date, scenario);
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
          predictedConversions: null, predictedRevenue: null, confidence, scenario });
      }
    }
    // All-or-nothing: 270 rows written in one transaction. The id is a fixed-length hash of
    // the business key (org, site, date, scenario): the former truncated id collided on the
    // primary key for long site URLs.
    let txActive = false;
    try {
      await client.query("BEGIN");
      txActive = true;
      for (const f of forecasts) {
        await client.query(
          `INSERT INTO seo_forecasts (id, org_id, site_url, forecast_date, predicted_traffic, predicted_conversions, predicted_revenue, confidence, scenario, source, generated_at)
             VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,'gsc',NOW())
           ON CONFLICT (org_id, site_url, forecast_date, scenario) DO UPDATE SET
             predicted_traffic=$5, predicted_conversions=0, predicted_revenue=0, confidence=$6, source='gsc', generated_at=NOW()`,
          [forecastRowId(orgId, siteUrl, f.date, f.scenario),
            orgId, siteUrl, f.date, f.predictedTraffic, f.confidence, f.scenario]
        );
      }
      await client.query("COMMIT");
      txActive = false;
    } catch (error) {
      if (txActive) await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
    const data = await getForecastData({ orgId, siteUrl });
    return { ...data, available: true, source: "gsc", reason: "Trafic projeté à partir des clics Google Search Console. Conversion et revenu nécessitent GA4." };
  } finally { client.release(); }
}
