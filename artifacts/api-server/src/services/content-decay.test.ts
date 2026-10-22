import { describe, expect, it } from "vitest";
import { findContentDecayOpportunities, findLowCtrOpportunities } from "./content-decay.js";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");

function row(page: string, date: string, clicks: number, impressions: number, position: number) {
  return { page, date, clicks, impressions, position };
}

describe("SEO content decay opportunities", () => {
  it("finds pages with material click loss or ranking decline and prioritizes the largest impact", () => {
    const rows = [
      row("https://example.com/guide", "2026-09-10", 100, 1000, 4),
      row("https://example.com/guide", "2026-10-10", 60, 900, 8),
      row("https://example.com/pricing", "2026-09-10", 40, 500, 5),
      row("https://example.com/pricing", "2026-10-10", 20, 500, 5),
    ];

    const results = findContentDecayOpportunities(rows, NOW);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      page: "https://example.com/guide",
      lostClicks: 40,
      positionDrop: 4,
      reasons: ["clicks_declining", "ranking_declining"],
    });
    expect(results[0].priorityScore).toBeGreaterThan(results[1].priorityScore);
  });

  it("ignores low-volume pages and rows outside the comparison window", () => {
    const rows = [
      row("https://example.com/low", "2026-09-10", 20, 99, 2),
      row("https://example.com/low", "2026-10-10", 1, 50, 20),
      row("https://example.com/old", "2026-08-01", 100, 1000, 1),
      row("https://example.com/old", "2026-10-10", 1, 500, 20),
    ];
    expect(findContentDecayOpportunities(rows, NOW)).toEqual([]);
  });

  it("finds unusually low-CTR pages against a same-position internal cohort", () => {
    const rows = [
      row("https://example.com/a", "2026-10-10", 10, 1000, 4),
      row("https://example.com/b", "2026-10-10", 50, 1000, 4),
      row("https://example.com/c", "2026-10-10", 60, 1000, 4),
      row("https://example.com/d", "2026-10-10", 55, 1000, 4),
    ];
    expect(findLowCtrOpportunities(rows, NOW)).toMatchObject([
      {
        page: "https://example.com/a",
        impressions: 1000,
        position: 4,
        comparisonCtr: 0.055,
      },
    ]);
  });
});

