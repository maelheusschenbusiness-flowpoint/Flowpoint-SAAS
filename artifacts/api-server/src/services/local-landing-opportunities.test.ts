import { describe, expect, it } from "vitest";
import {
  findLocalLandingOpportunities,
  normalizeLocalLandingSettings,
} from "./local-landing-opportunities.js";

describe("Local Landing Opportunities", () => {
  it("returns only measured queries matching a configured service and location", () => {
    const result = findLocalLandingOpportunities([
      { keyword: "Plombier Bruxelles", impressions: 120, clicks: 8, ctr: 8 / 120, position: 14.2, latestDate: "2026-10-22" },
      { keyword: "Plombier Anvers", impressions: 900, clicks: 90, ctr: 0.1, position: 16, latestDate: "2026-10-22" },
      { keyword: "Bruxelles dépannage", impressions: 80, clicks: 3, ctr: 3 / 80, position: 12, latestDate: "2026-10-22" },
      { keyword: "Plombier Bruxelles", impressions: 9, clicks: 0, ctr: 0, position: 14, latestDate: "2026-10-22" },
      { keyword: "Plombier Bruxelles", impressions: 100, clicks: 8, ctr: 0.08, position: 42, latestDate: "2026-10-22" },
    ], {
      services: ["plombier"],
      locations: ["Bruxelles"],
      minimumImpressions: 10,
      maximumPosition: 30,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      keyword: "Plombier Bruxelles",
      impressions: 120,
      clicks: 8,
      averagePosition: 14.2,
    });
    expect(result[0]?.recommendation).toContain("Vérifiez si une page dédiée");
    expect(result[0]?.evidence).toContain("Google Search Console");
  });

  it("normalizes criteria and refuses to invent candidates without both term groups", () => {
    expect(normalizeLocalLandingSettings({
      services: ["  réparation  ", "réparation", 4],
      locations: [" Liège "],
      minimumImpressions: -5,
      maximumPosition: 1000,
    })).toEqual({
      services: ["réparation"],
      locations: ["Liège"],
      minimumImpressions: 1,
      maximumPosition: 100,
    });
    expect(findLocalLandingOpportunities([], { services: [], locations: ["Liège"] })).toEqual([]);
  });
});
