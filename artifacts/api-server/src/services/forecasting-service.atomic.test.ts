import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, ga4 } = vi.hoisted(() => ({
  db: {
    connect: vi.fn(),
    query: vi.fn(),
    release: vi.fn(),
  },
  ga4: { getGA4ForecastHistory: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: db.connect },
}));
vi.mock("./ga4-service.js", () => ga4);

import { generateForecasts, getForecastData } from "./forecasting-service.js";

describe("forecast persistence safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.connect.mockResolvedValue({ query: db.query, release: db.release });
    ga4.getGA4ForecastHistory.mockResolvedValue(null);
  });

  afterEach(() => vi.restoreAllMocks());

  const measuredGa4History = (count = 14) => Array.from({ length: count }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    sessions: 50,
    conversions: 5,
    revenue: 125,
  }));

  it("does not report database read failures as missing forecast history", async () => {
    db.connect.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getForecastData({ orgId: "org-a", siteUrl: "https://a.example" }))
      .rejects.toThrow("database unavailable");
  });

  it("returns tenant-scoped insufficient_data when there are no persisted forecasts", async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await getForecastData({ orgId: "org-a", siteUrl: "https://a.example" });

    expect(result).toMatchObject({
      available: false,
      status: "insufficient_data",
      minimumHistoryDays: 14,
      forecasts: [],
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id=$1 AND site_url=$2"),
      ["org-a", "https://a.example"],
    );
  });

  it("does not turn invalid persisted metrics into zero-value forecasts", async () => {
    db.query.mockResolvedValue({
      rows: [{
        forecast_date: "2026-11-10",
        predicted_traffic: 100,
        predicted_conversions: 2,
        predicted_revenue: null,
        confidence: 70,
        scenario: "realistic",
        source: "gsc+ga4",
      }],
    });

    const result = await getForecastData({ orgId: "org-a", siteUrl: "https://a.example" });

    expect(result).toMatchObject({
      available: false,
      status: "insufficient_data",
      forecasts: [],
    });
    expect(result.reason).toContain("métriques invalides");
  });

  it("rolls back the whole forecast batch after a partial insert failure", async () => {
    const statements: string[] = [];
    let forecastInserts = 0;
    ga4.getGA4ForecastHistory.mockResolvedValue(measuredGa4History());
    db.query.mockImplementation(async (sql: string) => {
      statements.push(sql.trim());
      if (sql.includes("SELECT site_url FROM gsc_sites")) {
        return { rows: [{ site_url: "https://a.example" }] };
      }
      if (sql.includes("FROM gsc_keyword_data")) {
        return { rows: Array.from({ length: 14 }, (_, index) => ({
          date: `2026-10-${String(index + 1).padStart(2, "0")}`,
          clicks: 100,
        })) };
      }
      if (sql.startsWith("INSERT INTO seo_forecasts")) {
        forecastInserts += 1;
        if (forecastInserts === 2) throw new Error("simulated insert failure");
      }
      return { rows: [] };
    });

    await expect(generateForecasts("org-a", "https://a.example"))
      .rejects.toThrow("simulated insert failure");

    expect(forecastInserts).toBe(2);
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("returns explicit insufficient_data and persists nothing when GA4 history is too short", async () => {
    const statements: string[] = [];
    ga4.getGA4ForecastHistory.mockResolvedValue(measuredGa4History(13));
    db.query.mockImplementation(async (sql: string) => {
      statements.push(sql.trim());
      if (sql.includes("SELECT site_url FROM gsc_sites")) {
        return { rows: [{ site_url: "https://a.example" }] };
      }
      if (sql.includes("FROM gsc_keyword_data")) {
        return { rows: Array.from({ length: 14 }, (_, index) => ({
          date: `2026-10-${String(index + 1).padStart(2, "0")}`,
          clicks: 100,
        })) };
      }
      return { rows: [] };
    });

    const result = await generateForecasts("org-a", "https://a.example");

    expect(result).toMatchObject({
      available: false,
      status: "insufficient_data",
      minimumHistoryDays: 14,
      forecasts: [],
      ga4Available: false,
    });
    expect(result.reason).toContain("14 jours");
    expect(statements.some(sql => sql.startsWith("INSERT INTO seo_forecasts"))).toBe(false);
    expect(ga4.getGA4ForecastHistory).toHaveBeenCalledWith("org-a", "35daysAgo", "yesterday");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("rejects invalid GA4 measurements instead of turning missing values into zero forecasts", async () => {
    ga4.getGA4ForecastHistory.mockResolvedValue([
      ...measuredGa4History(13),
      { date: "2026-10-14", sessions: null, conversions: 0, revenue: 0 },
    ]);
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT site_url FROM gsc_sites")) {
        return { rows: [{ site_url: "https://a.example" }] };
      }
      if (sql.includes("FROM gsc_keyword_data")) {
        return { rows: Array.from({ length: 14 }, (_, index) => ({
          date: `2026-10-${String(index + 1).padStart(2, "0")}`,
          clicks: 100,
        })) };
      }
      return { rows: [] };
    });

    const result = await generateForecasts("org-a", "https://a.example");

    expect(result.status).toBe("insufficient_data");
    expect(result.forecasts).toEqual([]);
  });

  it("persists and returns forecasts only from valid tenant-scoped GSC and GA4 history", async () => {
    const inserts: unknown[][] = [];
    ga4.getGA4ForecastHistory.mockResolvedValue(measuredGa4History());
    db.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("SELECT site_url FROM gsc_sites")) {
        return { rows: [{ site_url: "https://a.example" }] };
      }
      if (sql.includes("FROM gsc_keyword_data")) {
        return { rows: Array.from({ length: 14 }, (_, index) => ({
          date: `2026-10-${String(index + 1).padStart(2, "0")}`,
          clicks: 100,
        })) };
      }
      if (sql.startsWith("INSERT INTO seo_forecasts")) {
        inserts.push(values ?? []);
        return { rows: [] };
      }
      if (sql.includes("FROM seo_forecasts")) {
        return {
          rows: inserts.map((row) => ({
            forecast_date: row[3],
            predicted_traffic: row[4],
            predicted_conversions: row[5],
            predicted_revenue: row[6],
            confidence: row[7],
            scenario: row[8],
            source: row[9],
          })),
        };
      }
      return { rows: [] };
    });

    const result = await generateForecasts("org-a", "https://a.example");

    expect(result).toMatchObject({
      available: true,
      status: "available",
      minimumHistoryDays: 14,
      ga4Available: true,
    });
    expect(result.forecasts).toHaveLength(270);
    expect(inserts).toHaveLength(270);
    expect(inserts[0]?.[1]).toBe("org-a");
    expect(inserts[0]?.[9]).toBe("gsc+ga4");
    expect(result.summary.expectedConversionsIn30d).toBeGreaterThan(0);
    expect(result.summary.expectedRevenueIn90d).toBeGreaterThan(0);
  });
});
