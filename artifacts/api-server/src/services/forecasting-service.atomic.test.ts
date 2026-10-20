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

  it("does not report database read failures as missing forecast history", async () => {
    db.connect.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getForecastData({ orgId: "org-a", siteUrl: "https://a.example" }))
      .rejects.toThrow("database unavailable");
  });

  it("rolls back the whole forecast batch after a partial insert failure", async () => {
    const statements: string[] = [];
    let forecastInserts = 0;
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
});
