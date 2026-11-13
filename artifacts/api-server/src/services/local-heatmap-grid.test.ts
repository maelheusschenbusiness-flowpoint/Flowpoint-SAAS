import { describe, expect, it } from "vitest";
import {
  buildLocalGeoGrid,
  findBusinessRank,
  normalizeBusinessName,
  summarizeMeasuredCells,
} from "./local-heatmap-grid.js";

describe("local geo heatmap", () => {
  it("creates a centered square grid with the requested radius and dimensions", () => {
    const points = buildLocalGeoGrid(50.85, 4.35, 5, 5);
    expect(points).toHaveLength(25);
    expect(points.find(point => point.row === 2 && point.column === 2)).toMatchObject({
      latitude: 50.85,
      longitude: 4.35,
    });
    expect(points[0]!.latitude).toBeGreaterThan(points[20]!.latitude);
    expect(points[4]!.longitude).toBeGreaterThan(points[0]!.longitude);
  });

  it("rejects invalid coordinates, radius and grid sizes", () => {
    expect(() => buildLocalGeoGrid(91, 4.35, 5, 5)).toThrow("Invalid latitude");
    expect(() => buildLocalGeoGrid(50, 181, 5, 5)).toThrow("Invalid longitude");
    expect(() => buildLocalGeoGrid(50, 4, 21, 5)).toThrow("Invalid radius");
    expect(() => buildLocalGeoGrid(50, 4, 5, 6)).toThrow("Invalid grid size");
  });

  it("matches business names without accents or punctuation but never invents a rank", () => {
    expect(normalizeBusinessName("Café René — Centre")).toBe("cafe rene centre");
    expect(findBusinessRank([{ name: "Cafe Rene Centre", rank: 4 }], "Café René — Centre")).toBe(4);
    expect(findBusinessRank([{ name: "Café René Centre", rank: 0 }], "Café René Centre")).toBeNull();
    expect(findBusinessRank([{ name: "Another business", rank: 2 }], "Café René Centre")).toBeNull();
  });

  it("separates measured coverage from rankings where the business was not in the returned results", () => {
    const summary = summarizeMeasuredCells([
      { row: 0, column: 0, latitude: 50, longitude: 4, status: "measured", rank: 2 },
      { row: 0, column: 1, latitude: 50, longitude: 4.1, status: "measured", rank: null },
      { row: 1, column: 0, latitude: 50.1, longitude: 4, status: "error", rank: null },
    ]);
    expect(summary).toEqual({
      measuredPoints: 2,
      totalPoints: 3,
      averageRank: 2,
      top3Points: 1,
      top10Points: 1,
      notFoundPoints: 1,
      coverageScore: 67,
      dominanceScore: 50,
    });
  });
});
