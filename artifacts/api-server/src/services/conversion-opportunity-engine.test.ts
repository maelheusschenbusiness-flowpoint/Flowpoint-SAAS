import { describe, expect, it } from "vitest";
import {
  findConversionOpportunities,
  normalizeConversionOpportunitySettings,
} from "./conversion-opportunity-engine.js";

describe("Conversion Opportunity Engine", () => {
  it("ranks measured GA4 landing pages with enough sessions and a low conversion rate", () => {
    const rows = [
      { dimensionValues: [{ value: "/contact" }], metricValues: [{ value: "100" }, { value: "90" }, { value: "1" }, { value: "0" }] },
      { dimensionValues: [{ value: "/pricing" }], metricValues: [{ value: "800" }, { value: "700" }, { value: "3" }, { value: "20" }] },
      { dimensionValues: [{ value: "/small" }], metricValues: [{ value: "50" }, { value: "45" }, { value: "0" }, { value: "0" }] },
    ];
    const result = findConversionOpportunities(rows, { minimumSessions: 100, maximumConversionRate: 0.02 });
    expect(result.map(page => page.landingPage)).toEqual(["/pricing", "/contact"]);
    expect(result[0]).toMatchObject({ sessions: 800, conversions: 3, revenue: 20 });
  });

  it("bounds settings and ignores pages without usable landing-page data", () => {
    expect(normalizeConversionOpportunitySettings({
      minimumSessions: -5,
      maximumConversionRate: 2,
    })).toEqual({ minimumSessions: 1, maximumConversionRate: 1 });
    expect(findConversionOpportunities([
      { dimensionValues: [{ value: "" }], metricValues: [{ value: "500" }, {}, { value: "0" }] },
    ], {})).toEqual([]);
  });
});
