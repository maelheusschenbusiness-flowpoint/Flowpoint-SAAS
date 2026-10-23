import { describe, expect, it } from "vitest";
import { compareSEOAuditSnapshots } from "./seo-change-impact.js";

describe("SEO Change Impact", () => {
  it("reports measured score and issue changes without predicting gains", () => {
    const result = compareSEOAuditSnapshots({
      auditId: "audit-before",
      capturedAt: "2026-10-01",
      score: 62,
      issues: [
        { code: "missing-title", severity: "high", affectedPages: 12 },
        { code: "slow-mobile", severity: "medium", affectedPages: 8 },
      ],
    }, {
      auditId: "audit-after",
      capturedAt: "2026-10-15",
      score: 71,
      issues: [
        { code: "slow-mobile", severity: "medium", affectedPages: 3 },
        { code: "broken-canonical", severity: "critical", affectedPages: 2 },
      ],
    });

    expect(result.scoreDelta).toBe(9);
    expect(result.resolved.map(issue => issue.code)).toEqual(["missing-title"]);
    expect(result.introduced.map(issue => issue.code)).toEqual(["broken-canonical"]);
    expect(result.changed).toEqual([
      { code: "slow-mobile", beforePages: 8, afterPages: 3, severity: "medium" },
    ]);
    expect(result).not.toHaveProperty("predictedGain");
  });

  it("treats repeated audit identifiers as no new measured comparison", () => {
    const audit = { auditId: "same", capturedAt: "2026-10-01", score: 50, issues: [] };
    expect(compareSEOAuditSnapshots(audit, audit).hasMeasuredChange).toBe(false);
  });
});
