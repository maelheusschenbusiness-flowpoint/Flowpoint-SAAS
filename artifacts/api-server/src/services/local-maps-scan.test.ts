import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: (...a: unknown[]) => query(...a), connect: vi.fn() } }));

const configured = vi.fn();
const consume = vi.fn();
const refund = vi.fn();
const lookup = vi.fn();
vi.mock("./dataforseo-service.js", () => ({
  isDataForSEOConfigured: (...a: unknown[]) => configured(...a),
  verifierEtConsommerQuota: (...a: unknown[]) => consume(...a),
  rembourserQuota: (...a: unknown[]) => refund(...a),
  getGoogleMapsResultsAtCoordinate: (...a: unknown[]) => lookup(...a),
  suivreAppelsPayants: async (fn: () => Promise<void>) => {
    await fn();
    return { appelsReussis: lookup.mock.calls.length };
  },
}));

import { runHeatmapScan, startHeatmapScan } from "./local-maps-service.js";

const row = {
  id: "hm_1", org_id: "org1", keyword: "plombier", grid_size: 5, center_lat: 50.8, center_lng: 4.3, radius_km: 5,
  results: { businessName: "Plomberie Dupont", cells: [] },
};

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  configured.mockReset(); consume.mockReset(); refund.mockReset(); lookup.mockReset();
});

describe("heatmaps Local — D-03", () => {
  it("sans clés DataForSEO : statut 'unavailable' explicite, aucun appel fournisseur ni quota consommé", async () => {
    configured.mockResolvedValue(false);
    await runHeatmapScan("org1", row);
    expect(lookup).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    const [sql, params] = query.mock.calls.at(-1)!;
    expect(sql).toContain("status='unavailable'");
    expect(JSON.parse(params[2])).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", cells: [] });
  });

  it("calcule une cellule par point de grille via le fournisseur (mocké) et termine en 'completed'", async () => {
    configured.mockResolvedValue(true);
    consume.mockResolvedValue({ autorise: true });
    lookup.mockResolvedValue({ results: [{ title: "Plomberie Dupont" }] });
    await runHeatmapScan("org1", row);
    expect(lookup).toHaveBeenCalledTimes(25);
    expect(consume).toHaveBeenCalledWith("org1", 25);
    const [sql, params] = query.mock.calls.at(-1)!;
    expect(params[2]).toBe("completed");
    const saved = JSON.parse(params[3]);
    expect(saved.cells).toHaveLength(25);
    expect(saved.summary.measuredPoints).toBe(25);
    expect(sql).toContain("UPDATE local_heatmaps");
  });

  it("quota fournisseur dépassé : statut 'failed', aucune mesure", async () => {
    configured.mockResolvedValue(true);
    consume.mockResolvedValue({ autorise: false, motif: "plafond" });
    await runHeatmapScan("org1", row);
    expect(lookup).not.toHaveBeenCalled();
    expect(refund).toHaveBeenCalledWith("org1", 25);
    expect(query.mock.calls.at(-1)![0]).toContain("status='failed'");
  });

  it("le claim est atomique et idempotent : un second claim ne lance aucun scan", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE ... RETURNING => 0 ligne (déjà pris)
    expect(await startHeatmapScan("org1", "hm_1")).toBe(false);
    expect(configured).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain("status IN ('pending','failed','unavailable')");
  });

  it("la création est plafonnée par plan (requireQuota 'heatmaps') avant toute écriture", () => {
    const src = readFileSync(new URL("../routes/local-maps.ts", import.meta.url), "utf8");
    // #368 nommait le garde (heatmapQuota) ; #385 l'inline : les deux placent le quota apres canWrite et avant le handler.
    expect(src).toMatch(/router\.post\("\/local-maps\/heatmaps",\s*canWrite,\s*(heatmapQuota|requireQuota\("heatmaps")/);
    expect(src).toContain('requireQuota("heatmaps"');
  });
});
