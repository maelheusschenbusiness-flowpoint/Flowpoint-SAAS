import { describe, expect, it } from "vitest";
import { analyzeLocalPresence } from "./local-presence-optimizer.js";

describe("Local Presence Optimizer", () => {
  it("scores only fields present in the real GBP profile payload", () => {
    const report = analyzeLocalPresence({
      title: "Café du Centre",
      primaryCategory: { displayName: "Café" },
      phoneNumbers: { primaryPhone: "+32 2 555 0101" },
      storefrontAddress: { locality: "Bruxelles" },
      regularHours: { periods: [{ openDay: "MONDAY" }] },
      profile: { description: "Café indépendant" },
    });
    expect(report.score).toBe(86);
    expect(report.opportunities.map(item => item.key)).toEqual(["websiteUri"]);
  });

  it("supports organization-selected fields and ignores unknown field keys", () => {
    const report = analyzeLocalPresence({}, ["phone", "websiteUri", "not-a-field"]);
    expect(report.totalFields).toBe(2);
    expect(report.score).toBe(0);
    expect(report.opportunities).toHaveLength(2);
  });

  it("does not fabricate a score when the profile payload is empty", () => {
    expect(analyzeLocalPresence(null).score).toBe(0);
  });
});
