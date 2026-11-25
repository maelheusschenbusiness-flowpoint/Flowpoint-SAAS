import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { connect: async () => ({ query: mockQuery, release: mockRelease }) },
}));

import { getMarketDashboard, marketDashboardSource } from "./market-intel-service.js";

/**
 * Beta certification : les deux periodes comparees doivent compter le meme nombre de jours.
 * Avec « >= CURRENT_DATE - 28 » la periode recente couvrait 29 jours (aujourd'hui + 28) contre 28
 * pour la precedente : un clic constant par jour affichait une croissance de ~ +3,6 % au lieu de 0.
 */
describe("getMarketDashboard — fenetres de 28 jours egales", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("recente = ]J-28, J], precedente = ]J-56, J-28] (aucune borne >= J-28 / < J-28)", async () => {
    await getMarketDashboard("org-1");
    const sql = String(mockQuery.mock.calls.find(([q]) => String(q).includes("FROM gsc_keyword_data"))![0]);
    expect(sql).toMatch(/recent_clicks/);
    expect(sql).toMatch(/::date > CURRENT_DATE - 28\)::int AS recent_clicks/);
    expect(sql).toMatch(/::date > CURRENT_DATE - 56\s+AND NULLIF\(date, ''\)::date <= CURRENT_DATE - 28\)::int AS previous_clicks/);
    expect(sql).toMatch(/::date > CURRENT_DATE - 28\)::int AS recent_impressions/);
    expect(sql).not.toMatch(/>= CURRENT_DATE - (28|56)/);
    expect(sql).not.toMatch(/< CURRENT_DATE - 28/);
  });
});

describe("marketDashboardSource", () => {
  it("gsc des qu'une tendance est mesuree, sinon competitor_rankings, sinon no_data", () => {
    expect(marketDashboardSource({ trends: [{} as never], competitor_movements: [] })).toBe("gsc");
    expect(marketDashboardSource({ trends: [], competitor_movements: [{} as never] })).toBe("competitor_rankings");
    expect(marketDashboardSource({ trends: [], competitor_movements: [] })).toBe("no_data");
  });
});
