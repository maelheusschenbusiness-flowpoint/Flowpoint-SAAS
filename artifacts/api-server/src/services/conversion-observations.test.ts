import { describe, expect, it } from "vitest";
import { calculateExperimentResult, deriveConversionObservations } from "./conversion-observations.js";

describe("conversion observations", () => {
  it("reports only observed friction, with source, frequency and sample-based confidence", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      page: "/checkout", sessionId: `s${i}`, eventType: "form_abandon",
    }));
    events.push({ page: "/checkout", sessionId: "s1", eventType: "form_abandon" });
    const [item] = deriveConversionObservations(events);
    expect(item).toMatchObject({
      page: "/checkout", eventType: "form_abandon", observedEvents: 13,
      affectedSessions: 12, confidence: "medium", source: "behavior_events",
    });
    expect(item?.recommendation).toContain("formulaire");
    expect(item).not.toHaveProperty("estimatedMonthlyLoss");
    expect(item).not.toHaveProperty("impactScore");
  });

  it("maps shallow scroll to an actionable observation and ignores empty pages", () => {
    expect(deriveConversionObservations([
      { page: "/home", sessionId: "s1", eventType: "scroll", scrollDepth: 20 },
      { page: "", sessionId: "s2", eventType: "exit" },
    ])).toMatchObject([{ eventType: "low_scroll", affectedSessions: 1, confidence: "low" }]);
  });

  it("keeps identical page paths separate across sites", () => {
    const observations = deriveConversionObservations([
      { siteUrl: "https://one.example", page: "/checkout", sessionId: "s1", eventType: "form_abandon" },
      { siteUrl: "https://two.example", page: "/checkout", sessionId: "s2", eventType: "form_abandon" },
    ]);
    expect(observations).toHaveLength(2);
    expect(observations.map(item => item.siteUrl)).toEqual(["https://one.example", "https://two.example"]);
  });
});

describe("A/B experiment statistics", () => {
  it("does not claim a result before both arms have enough real exposures", () => {
    expect(calculateExperimentResult(
      { exposures: 29, conversions: 10 }, { exposures: 100, conversions: 40 },
    )).toMatchObject({ status: "insufficient_data", pValue: null, winner: null });
  });

  it("reports two-proportion significance transparently", () => {
    const result = calculateExperimentResult(
      { exposures: 1000, conversions: 100 }, { exposures: 1000, conversions: 150 },
    );
    expect(result.status).toBe("significant");
    expect(result.winner).toBe("variant");
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("rejects impossible measurements", () => {
    expect(() => calculateExperimentResult(
      { exposures: 10, conversions: 11 }, { exposures: 40, conversions: 2 },
    )).toThrow("Invalid experiment counts");
  });
});
