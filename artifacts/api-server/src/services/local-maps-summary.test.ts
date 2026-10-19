import { describe, expect, it } from "vitest";
import { buildLocalMapsRecommendations, summarizeLocalMaps, type Heatmap } from "./local-maps-service.js";

const heatmap = (id: string, status: string): Heatmap => ({
  id, org_id: "org-1", name: id, keyword: "plombier", location_id: null,
  center_lat: 50, center_lng: 4, radius_km: 5, grid_size: 7, status, created_at: "2026-01-01",
});

describe("Local Domination Maps summary", () => {
  it("reports only stored counts and never invents rank or coverage", () => {
    const result = summarizeLocalMaps([heatmap("a", "completed"), heatmap("b", "pending")], 3);
    expect(result.summary).toMatchObject({
      totalHeatmaps: 2, completedScans: 1, competitorsAnalyzed: 3,
      avgRank: null, top3GridPoints: null, coverageScore: null, localVisibilityScore: null,
    });
    expect(result.insights[0]).toContain("2 carte(s) configurée(s)");
  });

  it("states when no local tracking data is stored", () => {
    const result = summarizeLocalMaps([], 0);
    expect(result.summary.totalHeatmaps).toBe(0);
    expect(result.insights).toEqual(["Aucune carte de suivi locale n’est enregistrée."]);
  });

  it("keeps recommendations tied to stored rows and avoids estimated rank gains", () => {
    const recommendations = buildLocalMapsRecommendations([heatmap("a", "pending")], 0);
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0].description).toContain("1 carte(s)");
    expect(recommendations[1].description).toContain("Aucun résultat concurrent");
    expect(recommendations.some(item => /%|position|rang/i.test(item.impact))).toBe(false);
  });
});
