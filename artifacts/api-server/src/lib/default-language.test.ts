import { describe, expect, it } from "vitest";
import { resolveDashboardLanguage } from "./default-language.js";

describe("resolveDashboardLanguage", () => {
  it("defaults to English when no preference has been saved", () => {
    expect(resolveDashboardLanguage(null, null)).toBe("en");
  });

  it("treats the legacy French database default as no explicit preference", () => {
    expect(resolveDashboardLanguage(null, "fr")).toBe("en");
    expect(resolveDashboardLanguage(null, "fr-FR")).toBe("en");
  });

  it("preserves an explicit user preference, including French", () => {
    expect(resolveDashboardLanguage("fr", "en")).toBe("fr");
    expect(resolveDashboardLanguage("nl", "fr")).toBe("nl");
  });

  it("preserves non-French legacy language values", () => {
    expect(resolveDashboardLanguage(null, "de")).toBe("de");
  });
});
