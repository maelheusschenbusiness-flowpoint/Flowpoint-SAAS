import { describe, expect, it } from "vitest";
import { verifyTechnicalSEOFix } from "./technical-seo-fix-verification.js";

const base = {
  issueCode: "missing-title",
  beforeAuditId: "audit-before",
  afterAuditId: "audit-after",
  beforeIssues: [{ code: "missing-title", severity: "high" as const, affectedPages: 12 }],
};

describe("Technical SEO Fix Verification", () => {
  it("verifies a fix only when the issue disappears from a distinct later audit", () => {
    expect(verifyTechnicalSEOFix({ ...base, afterIssues: [] })).toMatchObject({
      status: "verified_resolved",
      beforeAffectedPages: 12,
      afterAffectedPages: 0,
      evidence: "two_distinct_audits",
    });
  });

  it("reports measured improvement while the issue remains", () => {
    expect(verifyTechnicalSEOFix({
      ...base,
      afterIssues: [{ code: "missing-title", severity: "medium", affectedPages: 5 }],
    })).toMatchObject({ status: "improved", beforeAffectedPages: 12, afterAffectedPages: 5 });
  });

  it("does not claim verification without distinct audits or a baseline issue", () => {
    expect(verifyTechnicalSEOFix({ ...base, afterAuditId: base.beforeAuditId, afterIssues: [] }).status)
      .toBe("not_comparable");
    expect(verifyTechnicalSEOFix({
      ...base,
      beforeIssues: [],
      afterIssues: [],
    }).status).toBe("baseline_issue_not_found");
  });
});
