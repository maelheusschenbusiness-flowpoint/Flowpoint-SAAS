import { describe, expect, it } from "vitest";
import { verifyTechnicalSEOFix } from "./technical-seo-fix-verification.js";

const base = {
  beforeAuditId: "audit-before",
  afterAuditId: "audit-after",
};

describe("Technical SEO Fix Verification", () => {
  it("verifies resolution only when a later audit reports zero issues", () => {
    expect(verifyTechnicalSEOFix({ ...base, beforeIssueCount: 12, afterIssueCount: 0 })).toMatchObject({
      status: "verified_resolved",
      beforeIssueCount: 12,
      afterIssueCount: 0,
      evidence: "two_distinct_audits",
    });
  });

  it("reports measured improvement when the aggregate issue count decreases", () => {
    expect(verifyTechnicalSEOFix({ ...base, beforeIssueCount: 12, afterIssueCount: 5 }))
      .toMatchObject({ status: "improved", beforeIssueCount: 12, afterIssueCount: 5 });
  });

  it("does not claim a fix without comparable audits or a baseline issue", () => {
    expect(verifyTechnicalSEOFix({
      ...base, afterAuditId: base.beforeAuditId, beforeIssueCount: 4, afterIssueCount: 0,
    }).status).toBe("not_comparable");
    expect(verifyTechnicalSEOFix({ ...base, beforeIssueCount: 0, afterIssueCount: 0 }).status)
      .toBe("baseline_issue_not_found");
    expect(() => verifyTechnicalSEOFix({ ...base, beforeIssueCount: -1, afterIssueCount: 0 }))
      .toThrow(RangeError);
  });
});
