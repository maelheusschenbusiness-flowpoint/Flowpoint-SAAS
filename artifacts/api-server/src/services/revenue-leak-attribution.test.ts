import { describe, expect, it } from "vitest";
import { REVENUE_LEAK_ATTRIBUTION, revenueLeakFinancials } from "./revenue-leak-attribution.js";

describe("Revenue Leak attribution readiness", () => {
  it("is explicit when behavior and aggregate GA4 revenue have no exact shared join key", () => {
    expect(REVENUE_LEAK_ATTRIBUTION).toMatchObject({
      status: "insufficient_data",
      reason: "no_shared_identifier",
    });
    expect(REVENUE_LEAK_ATTRIBUTION.message).toContain("identifiant de session du tracker");
    expect(REVENUE_LEAK_ATTRIBUTION.message).toContain("agrégés");
  });

  it("never converts aggregate revenue into an attributed loss", () => {
    expect(revenueLeakFinancials()).toEqual({
      status: "insufficient_data",
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    });
  });
});
