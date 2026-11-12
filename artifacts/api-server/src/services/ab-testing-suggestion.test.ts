import { describe, expect, it } from "vitest";
import { parseAbTestingSuggestion } from "./ab-testing-suggestion.js";

describe("A/B testing AI suggestion parser", () => {
  it("accepts a complete, bounded proposal", () => {
    expect(parseAbTestingSuggestion(JSON.stringify({
      hypothesis: "A more specific CTA may improve form starts.",
      variantBText: "Book a 15-minute demo",
      rationale: "The page has repeated rage clicks near the CTA.",
      successMetric: "Form submissions per exposed session",
    }))).toEqual({
      hypothesis: "A more specific CTA may improve form starts.",
      variantBText: "Book a 15-minute demo",
      rationale: "The page has repeated rage clicks near the CTA.",
      successMetric: "Form submissions per exposed session",
    });
  });

  it("rejects malformed or incomplete model output", () => {
    expect(parseAbTestingSuggestion("not json")).toBeNull();
    expect(parseAbTestingSuggestion(JSON.stringify({ hypothesis: "Try a new CTA" }))).toBeNull();
  });

  it("rejects oversized or control-character copy", () => {
    expect(parseAbTestingSuggestion(JSON.stringify({
      hypothesis: "h".repeat(501),
      variantBText: "Variant B",
      rationale: "Reason",
      successMetric: "Submissions",
    }))).toBeNull();
    expect(parseAbTestingSuggestion(JSON.stringify({
      hypothesis: "A safe hypothesis",
      variantBText: "Bad\u0000copy",
      rationale: "Reason",
      successMetric: "Submissions",
    }))).toBeNull();
  });
});
