import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock pool (overrides the fake global pool of vitest.setup.ts)
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(async () => ({ query: mockQuery, release: mockRelease }));

vi.mock("@workspace/db", () => ({
  pool: { connect: () => mockConnect() },
}));

import { generateForecasts, getForecastData, forecastRowId } from "./forecasting-service.js";

/**
 * getForecastData — stored forecast summary (PR #496, re-applied on Flowpoint).
 * Frozen clock, mocked pool (no DB, no network).
 *   - growth goes from days 1-30 to days 31-60 (both in the future);
 *   - a row dated in the past is never counted as a first forecast day.
 */
describe("getForecastData — stored forecasts", () => {
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
  afterEach(() => { vi.useRealTimers(); });

  function utcDay(offset: number): string {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function storedRow(offset: number, traffic: number, confidence = 70): Record<string, unknown> {
    return {
      forecast_date: utcDay(offset),
      predicted_traffic: traffic,
      predicted_conversions: 1,
      predicted_revenue: 10,
      confidence,
      scenario: "realistic",
      source: "gsc",
    };
  }

  function series(days: number, trafficForDay: (day: number) => number, confidence = 70) {
    return Array.from({ length: days }, (_, i) => storedRow(1 + i, trafficForDay(i + 1), confidence));
  }

  const EMPTY_ANSWER = {
    siteUrl: SITE,
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
    generatedAt: NOW.toISOString(),
  };

  it("floors the stored read at the current UTC day, scoped by org and site", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getForecastData({ orgId: ORG, siteUrl: SITE });
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/forecast_date >= \(NOW\(\) AT TIME ZONE 'UTC'\)::date/);
    expect(sql).toMatch(/FROM seo_forecasts/);
    expect(params).toEqual([ORG, SITE]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("reports a positive growth for a rising forecast", async () => {
    mockQuery.mockResolvedValueOnce({ rows: series(60, d => (d <= 30 ? 100 : 200)) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.growthScenarios).toEqual({ pessimistic: 60, realistic: 100, optimistic: 140 });
    expect(data.summary.expectedTrafficIn30d).toBe(3000);
  });

  it("reports a negative growth for a declining forecast", async () => {
    mockQuery.mockResolvedValueOnce({ rows: series(60, d => (d <= 30 ? 200 : 100)) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.growthScenarios).toEqual({ pessimistic: -30, realistic: -50, optimistic: -70 });
  });

  it("reports no growth for a flat forecast", async () => {
    mockQuery.mockResolvedValueOnce({ rows: series(60, () => 100) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.growthScenarios).toEqual({ pessimistic: 0, realistic: 0, optimistic: 0 });
  });

  it("reports no growth below sixty days instead of NaN", async () => {
    mockQuery.mockResolvedValueOnce({ rows: series(30, () => 100) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.available).toBe(true);
    for (const v of Object.values(data.summary.growthScenarios)) {
      expect(v).toBe(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("reports no growth when the first thirty days carry no traffic", async () => {
    mockQuery.mockResolvedValueOnce({ rows: series(60, d => (d <= 30 ? 0 : 100)) });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    for (const v of Object.values(data.summary.growthScenarios)) {
      expect(v).toBe(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("ignores rows left over from an earlier generation", async () => {
    const stale = Array.from({ length: 5 }, (_, i) => storedRow(i - 5, 9999, 10));
    mockQuery.mockResolvedValueOnce({ rows: [...stale, ...series(85, () => 100, 80)] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.summary.expectedTrafficIn30d).toBe(3000);
    expect(data.summary.expectedTrafficIn90d).toBe(8500);
    expect(data.summary.confidenceScore).toBe(80);
    expect(data.forecasts).toHaveLength(85);
    expect(data.forecasts.every(p => p.date >= utcDay(0))).toBe(true);
  });

  it("keeps a row dated today in UTC", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [storedRow(0, 120)] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data.available).toBe(true);
    expect(data.forecasts).toHaveLength(1);
    expect(data.summary.expectedTrafficIn30d).toBe(120);
  });

  it("answers like the empty state for a purely stale forecast", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [storedRow(-3, 9999), storedRow(-2, 9999), storedRow(-1, 9999)] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data).toEqual(EMPTY_ANSWER);
  });

  it("returns the honest empty state when no row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const data = await getForecastData({ orgId: ORG, siteUrl: SITE });
    expect(data).toEqual(EMPTY_ANSWER);
    expect(data.available).toBe(false);
    expect(data.forecasts).toEqual([]);
  });

  describe("generateForecasts — ids and transaction", () => {
    const LONG_SITE = "https://sous-domaine-tres-long.exemple-de-site-vraiment-long.com/section/page/";
    const ORG_UUID = "123e4567-e89b-12d3-a456-426614174000";

    it("builds unique fixed-length ids for a long site URL", () => {
      const ids = new Set<string>();
      for (let day = 1; day <= 90; day++) {
        const date = utcDay(day);
        for (const scenario of ["pessimistic", "realistic", "optimistic"]) {
          const id = forecastRowId(ORG_UUID, LONG_SITE, date, scenario);
          expect(id.length).toBeLessThanOrEqual(80);
          ids.add(id);
        }
      }
      expect(ids.size).toBe(270);
    });

    function setupGenerate(failOnInsert?: number) {
      let inserts = 0;
      const ids: string[] = [];
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (/FROM gsc_sites/.test(sql)) return { rows: [{ site_url: LONG_SITE }] };
        if (/FROM gsc_keyword_data/.test(sql)) {
          return { rows: Array.from({ length: 30 }, (_, i) => ({ date: utcDay(-30 + i), clicks: 10 })) };
        }
        if (/INSERT INTO seo_forecasts/.test(sql)) {
          inserts++;
          if (failOnInsert && inserts === failOnInsert) throw new Error("boom");
          ids.push(String(params?.[0]));
          return { rows: [] };
        }
        return { rows: [] };
      });
      return { ids, calls: () => mockQuery.mock.calls.map(c => String(c[0])) };
    }

    it("writes 270 distinct ids inside one transaction (long URL)", async () => {
      const ctx = setupGenerate();
      await generateForecasts(ORG_UUID, LONG_SITE);
      expect(ctx.ids).toHaveLength(270);
      expect(new Set(ctx.ids).size).toBe(270);
      const calls = ctx.calls();
      const begin = calls.indexOf("BEGIN");
      const commit = calls.indexOf("COMMIT");
      const firstInsert = calls.findIndex(c => /INSERT INTO seo_forecasts/.test(c));
      const lastInsert = calls.map(c => /INSERT INTO seo_forecasts/.test(c)).lastIndexOf(true);
      expect(begin).toBeGreaterThan(-1);
      expect(begin).toBeLessThan(firstInsert);
      expect(lastInsert).toBeLessThan(commit);
      expect(calls).not.toContain("ROLLBACK");
    });

    it("rolls back everything when one insert fails", async () => {
      const ctx = setupGenerate(100);
      await expect(generateForecasts(ORG_UUID, LONG_SITE)).rejects.toThrow("boom");
      const calls = ctx.calls();
      expect(calls).toContain("ROLLBACK");
      expect(calls).not.toContain("COMMIT");
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });
});
