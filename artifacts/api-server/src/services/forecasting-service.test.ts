import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock pool (override du faux pool global de vitest.setup.ts) ─────────────
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(async () => ({ query: mockQuery, release: mockRelease }));

vi.mock("@workspace/db", () => ({
  pool: { connect: () => mockConnect() },
}));

import { MINIMUM_HISTORY_DAYS, getForecastData, projectGA4DailyMetric } from "./forecasting-service.js";

describe("GA4 forecast metrics", () => {
  it("documents a 14-observation minimum", () => {
    expect(MINIMUM_HISTORY_DAYS).toBe(14);
  });

  it("does not project a metric from fewer than 14 observed days", () => {
    expect(projectGA4DailyMetric(Array(13).fill(20), 30, 1)).toBe(0);
  });

  it("projects conversions from the measured recent baseline", () => {
    expect(projectGA4DailyMetric(Array(14).fill(10), 30, 1)).toBe(10);
    expect(projectGA4DailyMetric(Array(14).fill(10), 30, 0.9)).toBe(9);
  });

  it("rounds revenue to cents and never emits a negative projection", () => {
    expect(projectGA4DailyMetric(Array(14).fill(12.345), 30, 1, 2)).toBe(12.35);
    expect(projectGA4DailyMetric(Array(14).fill(0), 30, 0.9, 2)).toBe(0);
  });

  it("limits the trend extrapolation to five percent per day", () => {
    const increasing = [...Array(14).fill(0), ...Array(14).fill(100)];
    expect(projectGA4DailyMetric(increasing, 1, 1)).toBe(105);
  });

  it("refuses invalid metric history instead of projecting missing values as zero", () => {
    expect(projectGA4DailyMetric([...Array(13).fill(20), Number.NaN], 30, 1)).toBe(0);
    expect(projectGA4DailyMetric([...Array(13).fill(20), -1], 30, 1)).toBe(0);
  });
});

/**
 * getForecastData — résumé des prévisions enregistrées.
 *
 * Le tableau de bord lit des lignes déjà écrites en base. Deux garanties sont
 * vérifiées ici, horloge figée et pool simulé (ni base, ni réseau) :
 *   - la croissance va des jours 1-30 vers les jours 31-60 (tous deux futurs) ;
 *   - une ligne dont la date est déjà passée n'est jamais comptée comme un
 *     premier jour de prévision, en base comme en TypeScript.
 */
describe("getForecastData — prévisions enregistrées", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z");
  const ORG = "org-1";
  const SITE = "https://example.com/";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Date UTC décalée de `offset` jours par rapport à l'horloge figée. */
  function utcDay(offset: number): string {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function storedRow(
    offset: number,
    traffic: number,
    options: { confidence?: number; scenario?: string; conversions?: number; revenue?: number } = {},
  ): Record<string, unknown> {
    return {
      forecast_date: utcDay(offset),
      predicted_traffic: traffic,
      predicted_conversions: options.conversions ?? 1,
      predicted_revenue: options.revenue ?? 10,
      confidence: options.confidence ?? 70,
      scenario: options.scenario ?? "realistic",
      source: "gsc+ga4",
    };
  }

  /** `days` lignes réalistes consécutives, à partir de demain par défaut. */
  function realisticSeries(
    days: number,
    trafficForDay: (day: number) => number,
    options: { startOffset?: number; confidence?: number } = {},
  ): Record<string, unknown>[] {
    const startOffset = options.startOffset ?? 1;
    return Array.from({ length: days }, (_, index) =>
      storedRow(startOffset + index, trafficForDay(index + 1), { confidence: options.confidence }));
  }

  /**
   * Réponse rendue quand aucune ligne future n'est disponible. C'est, champ pour champ,
   * la réponse d'avant la correction pour une lecture sans ligne : l'horloge étant figée,
   * `generatedAt` est déterministe et peut donc être comparé lui aussi.
   */
  const EMPTY_ANSWER = {
    siteUrl: SITE,
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
    generatedAt: NOW.toISOString(),
  };

  it("floors the stored read at the current UTC day", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getForecastData({ orgId: ORG, siteUrl: SITE });
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/forecast_date >= \(NOW\(\) AT TIME ZONE 'UTC'\)::date/);
    expect(sql).toMatch(/FROM seo_forecasts/);
    expect(params).toEqual([ORG, SITE]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("reports a positive growth for a rising forecast", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: realisticSeries(60, day => (day <= 30 ? 100 : 200)),
    });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    const { pessimistic, realistic, optimistic } = data.summary.growthScenarios;
    expect(realistic).toBe(100);
    expect(realistic).toBeGreaterThan(0);
    expect(pessimistic).toBeLessThan(realistic);
    expect(realistic).toBeLessThan(optimistic);
    expect(pessimistic).toBe(60);
    expect(optimistic).toBe(140);
    expect(data.summary.expectedTrafficIn30d).toBe(3000);
  });

  it("reports a negative growth for a declining forecast", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: realisticSeries(60, day => (day <= 30 ? 200 : 100)),
    });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.growthScenarios.realistic).toBe(-50);
    expect(data.summary.growthScenarios.pessimistic).toBe(-30);
    expect(data.summary.growthScenarios.optimistic).toBe(-70);
  });

  it("reports no growth for a flat forecast", async () => {
    mockQuery.mockResolvedValueOnce({ rows: realisticSeries(60, () => 100) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.growthScenarios).toEqual({ pessimistic: 0, realistic: 0, optimistic: 0 });
  });

  it("reports no growth below sixty realistic days instead of NaN", async () => {
    mockQuery.mockResolvedValueOnce({ rows: realisticSeries(30, () => 100) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.available).toBe(true);
    for (const value of Object.values(data.summary.growthScenarios)) {
      expect(value).toBe(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("reports no growth when the first thirty days carry no traffic", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: realisticSeries(60, day => (day <= 30 ? 0 : 100)),
    });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    for (const value of Object.values(data.summary.growthScenarios)) {
      expect(value).toBe(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("ignores rows left over from an earlier generation", async () => {
    const stale = Array.from({ length: 5 }, (_, index) =>
      storedRow(index - 5, 9999, { confidence: 10 }));
    const upcoming = realisticSeries(85, () => 100, { confidence: 80 });
    mockQuery.mockResolvedValueOnce({ rows: [...stale, ...upcoming] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.expectedTrafficIn30d).toBe(3000);
    expect(data.summary.expectedTrafficIn90d).toBe(8500);
    expect(data.summary.confidenceScore).toBe(80);
    expect(data.forecasts).toHaveLength(85);
    expect(data.forecasts.every(point => point.date >= utcDay(0))).toBe(true);
  });

  it("keeps a row dated today in UTC", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [storedRow(0, 120)] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.available).toBe(true);
    expect(data.status).toBe("available");
    expect(data.forecasts).toHaveLength(1);
    expect(data.forecasts[0]?.date).toBe(utcDay(0));
    expect(data.summary.expectedTrafficIn30d).toBe(120);
  });

  it("treats a purely stale forecast as insufficient data", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [storedRow(-3, 9999), storedRow(-2, 9999), storedRow(-1, 9999)],
    });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.available).toBe(false);
    expect(data.status).toBe("insufficient_data");
    expect(data.forecasts).toEqual([]);
    expect(data.summary.expectedTrafficIn30d).toBe(0);
    expect(data.summary.growthScenarios).toEqual({ pessimistic: 0, realistic: 0, optimistic: 0 });
    // Même réponse que pour une absence de ligne enregistrée.
    expect(data).toEqual(EMPTY_ANSWER);
  });

  it("leaves the no-row answer exactly as it is today, field for field", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    // Aucune ligne enregistrée : le plancher de date ne change rien à cette réponse,
    // elle reste identique champ pour champ à celle rendue avant la correction.
    expect(data).toEqual(EMPTY_ANSWER);
    expect(data.available).toBe(false);
    expect(data.status).toBe("insufficient_data");
    expect(data.source).toBe("none");
    expect(data.siteUrl).toBe(SITE);
    expect(data.forecasts).toEqual([]);
    expect(data.reason).toBe("Données historiques insuffisantes pour générer une prévision.");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
