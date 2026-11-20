import { describe, expect, it } from "vitest";
import {
  buildSEOChangeImpacts,
  compareSEOAuditSnapshots,
  DEFAULT_SEO_CHANGE_IMPACT_SETTINGS,
  normalizeSEOChangeImpactSettings,
  validateSEOChangeImpactSettings,
} from "./seo-change-impact.js";

describe("SEO Change Impact", () => {
  it("compares measured score, critical issue count, and speed without predicting gains", () => {
    const result = compareSEOAuditSnapshots({
      auditId: "audit-before",
      siteUrl: "https://example.com",
      capturedAt: "2026-10-01T00:00:00.000Z",
      score: 62,
      criticalIssues: 12,
      speed: 54,
      status: "warn",
    }, {
      auditId: "audit-after",
      siteUrl: "https://example.com",
      capturedAt: "2026-10-15T00:00:00.000Z",
      score: 71,
      criticalIssues: 3,
      speed: 68,
      status: "ok",
    });

    expect(result.scoreDelta).toBe(9);
    expect(result.criticalIssueDelta).toBe(-9);
    expect(result.speedDelta).toBe(14);
    expect(result.hasMeasuredChange).toBe(true);
    expect(result).not.toHaveProperty("predictedGain");
  });

  it("compares the two newest completed audits per URL and ignores processing/error rows", () => {
    const comparisons = buildSEOChangeImpacts([
      { auditId: "old", siteUrl: "https://a.test", capturedAt: "2026-10-01", score: 50, criticalIssues: 8, speed: 40, status: "warn" },
      { auditId: "new", siteUrl: "https://a.test", capturedAt: "2026-10-10", score: 65, criticalIssues: 4, speed: 60, status: "ok" },
      { auditId: "processing", siteUrl: "https://a.test", capturedAt: "2026-10-11", score: 0, criticalIssues: 0, speed: 0, status: "processing" },
      { auditId: "error", siteUrl: "https://a.test", capturedAt: "2026-10-12", score: 0, criticalIssues: 0, speed: 0, status: "error" },
      { auditId: "single", siteUrl: "https://b.test", capturedAt: "2026-10-10", score: 75, criticalIssues: 1, speed: 70, status: "ok" },
    ], DEFAULT_SEO_CHANGE_IMPACT_SETTINGS);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]).toMatchObject({ siteUrl: "https://a.test", beforeAuditId: "old", afterAuditId: "new", scoreDelta: 15 });
  });

  it("validates persisted settings and falls back safely when stored JSON is invalid", () => {
    expect(validateSEOChangeImpactSettings({ lookbackDays: 30, minimumScoreChange: 5 })).toEqual({ lookbackDays: 30, minimumScoreChange: 5 });
    expect(validateSEOChangeImpactSettings({ lookbackDays: 2, minimumScoreChange: 5 })).toBeNull();
    expect(validateSEOChangeImpactSettings({ lookbackDays: 30, minimumScoreChange: 101 })).toBeNull();
    expect(normalizeSEOChangeImpactSettings("{broken")).toEqual(DEFAULT_SEO_CHANGE_IMPACT_SETTINGS);
  });
});
