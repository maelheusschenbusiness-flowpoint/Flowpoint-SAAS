import { describe, expect, it } from "vitest";
import { buildKeywordDominationReport } from "./keyword-domination.js";

describe("buildKeywordDominationReport", () => {
  it("ranks real tracked keywords in positions 4–20 without inventing traffic estimates", () => {
    const result = buildKeywordDominationReport([
      { keyword: "seo bruxelles", current_position: 5, prev_position: 8, position_change: 3, search_volume: 900, difficulty: 20, url: "https://example.test/seo", intent: "commercial" },
      { keyword: "seo belgique", current_position: 18, prev_position: 15, position_change: -3, search_volume: 400, difficulty: 35, url: null, intent: null },
      { keyword: "seo", current_position: 2, prev_position: 3, position_change: 1, search_volume: 1200, difficulty: 70, url: null, intent: null },
      { keyword: "sans volume", current_position: 7, prev_position: null, position_change: null, search_volume: 0, difficulty: null, url: null, intent: null },
    ]);

    expect(result.summary).toEqual({ tracked: 4, top3: 1, strikingDistance: 2, atRisk: 1 });
    expect(result.opportunities[0]?.keyword).toBe("seo bruxelles");
    expect(result.atRisk[0]?.keyword).toBe("seo belgique");
    expect(result.opportunities[0]).not.toHaveProperty("estimatedTraffic");
  });

  it("handles empty and malformed numeric data safely", () => {
    expect(buildKeywordDominationReport([
      { keyword: "", current_position: "bad", prev_position: null, position_change: null, search_volume: null, difficulty: null, url: null, intent: null },
    ])).toEqual({ summary: { tracked: 0, top3: 0, strikingDistance: 0, atRisk: 0 }, opportunities: [], atRisk: [] });
  });
});
