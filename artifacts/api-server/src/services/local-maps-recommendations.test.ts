import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: (...a: unknown[]) => query(...a),
    connect: vi.fn(async () => ({ query: (...a: unknown[]) => query(...a), release: vi.fn() })),
  },
}));
vi.mock("./dataforseo-service.js", () => ({}));

import { buildGbpLocalRecommendations, generateAiLocalRecommendations } from "./local-maps-service.js";

beforeEach(() => query.mockReset());

describe("recommandations Local — D-04", () => {
  it("dérive les recommandations des fiches réelles, sans pourcentage inventé", () => {
    const recs = buildGbpLocalRecommendations([
      { name: "Café A", rating: 3.2, reviews_count: 40, phone: null, website: "https://a.test" },
      { name: "Café B", rating: 4.8, reviews_count: 120, phone: "0102030405", website: "https://b.test" },
    ]);
    expect(recs.map(r => r.title)).toEqual([
      "Renseigner un téléphone sur la fiche « Café A »",
      "Traiter les avis négatifs de « Café A »",
    ]);
    expect(recs[1]!.description).toContain("3.2/5 sur 40 avis");
    expect(JSON.stringify(recs)).not.toMatch(/\d+\s?%|\+35/);
  });

  it("deux établissements différents ne reçoivent pas la même liste", () => {
    const a = buildGbpLocalRecommendations([{ name: "A", rating: 3, reviews_count: 5, phone: null, website: null }]);
    const b = buildGbpLocalRecommendations([{ name: "B", rating: 4.9, reviews_count: 300, phone: "1", website: "x" }]);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual([]);
  });

  it("sans donnée : liste vide + état explicite 'empty'", async () => {
    query.mockResolvedValue({ rows: [] });
    const r = await generateAiLocalRecommendations("org1");
    expect(r.status).toBe("empty");
    expect(r.recommendations).toEqual([]);
    expect(r.message).toMatch(/Google Business|analyse locale/);
  });
});
