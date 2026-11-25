import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { connect: async () => ({ query: mockQuery, release: mockRelease }) },
}));

import { generateForecasts, getForecastData, toIsoDay } from "./forecasting-service.js";

/**
 * Beta certification (Market Intelligence / AI Forecasting) :
 *  - POST /forecast/generate answered 500 on a GSC-active site with 35 days of data, because
 *    gsc_keyword_data.date is TEXT and the history query compared it to a timestamp
 *    ("operator does not exist: text >= timestamp");
 *  - GET /forecast leaked String(Date) ("Wed Nov 25 2026 00:00:00 GMT+0000 ...") as the day.
 * The pool is mocked, so the SQL text itself is what these tests pin down.
 */
describe("generateForecasts — history query on a TEXT date column", () => {
  const ORG = "org-1";
  const SITE = "https://example.com/";

  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
  });

  function historyCall(): string {
    const call = mockQuery.mock.calls.find(([sql]) => String(sql).includes("FROM gsc_keyword_data"));
    expect(call).toBeDefined();
    return String(call![0]);
  }

  it("casts the TEXT date before comparing it with CURRENT_DATE and groups on the cast day", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM gsc_sites")) return { rows: [{ site_url: SITE }] };
      if (sql.includes("FROM gsc_keyword_data")) return { rows: [] };
      return { rows: [] };
    });
    const out = await generateForecasts(ORG, SITE);
    const sql = historyCall();
    expect(sql).toMatch(/NULLIF\(date,\s*''\)::date\s*>=\s*CURRENT_DATE/);
    expect(sql).not.toMatch(/AND\s+date\s*>=/);
    expect(sql).toMatch(/GROUP BY 1/);
    // fewer than 14 days: honest empty state, no write
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/14 jours/);
    expect(mockQuery.mock.calls.some(([s]) => String(s).includes("INSERT INTO seo_forecasts"))).toBe(false);
  });

  it("writes 270 rows (90 days x 3 scenarios) once 14 days of clicks exist", async () => {
    const rows = Array.from({ length: 28 }, (_, i) => ({ day: `2026-06-${String(i + 1).padStart(2, "0")}`, clicks: 10 + i }));
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM gsc_sites")) return { rows: [{ site_url: SITE }] };
      if (sql.includes("FROM gsc_keyword_data")) return { rows };
      return { rows: [] };
    });
    await generateForecasts(ORG, SITE);
    const inserts = mockQuery.mock.calls.filter(([s]) => String(s).includes("INSERT INTO seo_forecasts"));
    expect(inserts).toHaveLength(270);
  });
});

describe("forecast day serialisation", () => {
  it("answers YYYY-MM-DD for a Date returned by node-postgres", () => {
    expect(toIsoDay(new Date(2026, 10, 25))).toBe("2026-11-25");
  });

  it("keeps an ISO string and trims a timestamp string", () => {
    expect(toIsoDay("2026-11-25")).toBe("2026-11-25");
    expect(toIsoDay("2026-11-25T00:00:00.000Z")).toBe("2026-11-25");
  });

  it("getForecastData exposes ISO days, never String(Date)", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({
      rows: [{
        forecast_date: new Date(2026, 10, 25), predicted_traffic: 10, predicted_conversions: 0,
        predicted_revenue: 0, confidence: 70, scenario: "realistic", source: "gsc",
      }],
    });
    const data = await getForecastData({ orgId: "org-1", siteUrl: "https://example.com/" });
    expect(data.forecasts[0]?.date).toBe("2026-11-25");
  });
});
