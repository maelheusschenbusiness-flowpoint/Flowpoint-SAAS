import { describe, expect, it } from "vitest";
import { deriveCompetitorMovements, deriveMarketTrends } from "./market-intel-service.js";

describe("market intelligence uses measured observations only", () => {
  it("derives GSC trend rows and leaves growth unknown without a comparison period", () => {
    const result = deriveMarketTrends([
      { keyword: "  audit local ", recent_clicks: 8, previous_clicks: 4, recent_impressions: 320 },
      { keyword: "new query", recent_clicks: 2, previous_clicks: 0, recent_impressions: 20 },
      { keyword: "empty", recent_clicks: 0, previous_clicks: 0, recent_impressions: 0 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      keyword: "audit local",
      category: "Google Search Console",
      search_volume: 320,
      growth_rate: 100,
      trend_direction: "up",
    });
    expect(result[1]).toMatchObject({ keyword: "new query", growth_rate: null, trend_direction: "stable" });
  });

  it("detects gains/losses only from two distinct observed ranking snapshots", () => {
    const result = deriveCompetitorMovements([
      { competitor_domain: "EXAMPLE.COM", keyword: "seo local", position: 3, checked_at: "2026-10-19T12:00:00Z" },
      { competitor_domain: "example.com", keyword: "seo local", position: 8, checked_at: "2026-10-12T12:00:00Z" },
      { competitor_domain: "other.example", keyword: "seo local", position: 7, checked_at: "2026-10-19T12:00:00Z" },
      { competitor_domain: "other.example", keyword: "seo local", position: 4, checked_at: "2026-10-12T12:00:00Z" },
      { competitor_domain: "new.example", keyword: "seo local", position: 2, checked_at: "2026-10-19T12:00:00Z" },
      { competitor_domain: "same.example", keyword: "unchanged", position: 6, checked_at: "2026-10-19T12:00:00Z" },
      { competitor_domain: "same.example", keyword: "unchanged", position: 6, checked_at: "2026-10-12T12:00:00Z" },
    ]);

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ competitor: "example.com", type: "ranking_gain" }),
      expect.objectContaining({ competitor: "other.example", type: "ranking_loss" }),
    ]));
  });
});
