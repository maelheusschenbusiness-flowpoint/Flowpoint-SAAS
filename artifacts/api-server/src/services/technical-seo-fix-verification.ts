export type FixVerificationStatus =
  | "verified_resolved"
  | "improved"
  | "still_present"
  | "baseline_issue_not_found"
  | "not_comparable";

export function verifyTechnicalSEOFix(input: {
  beforeAuditId: string;
  afterAuditId: string;
  beforeIssueCount: number;
  afterIssueCount: number;
}): {
  status: FixVerificationStatus;
  beforeIssueCount: number | null;
  afterIssueCount: number | null;
  evidence: "two_distinct_audits" | "insufficient_audit_evidence";
} {
  if (!input.beforeAuditId || !input.afterAuditId || input.beforeAuditId === input.afterAuditId) {
    return {
      status: "not_comparable",
      beforeIssueCount: null,
      afterIssueCount: null,
      evidence: "insufficient_audit_evidence",
    };
  }
  if (
    !Number.isInteger(input.beforeIssueCount) || input.beforeIssueCount < 0
    || !Number.isInteger(input.afterIssueCount) || input.afterIssueCount < 0
  ) {
    throw new RangeError("Audit issue counts must be non-negative integers");
  }
  if (input.beforeIssueCount === 0) {
    return {
      status: "baseline_issue_not_found",
      beforeIssueCount: 0,
      afterIssueCount: input.afterIssueCount,
      evidence: "two_distinct_audits",
    };
  }
  return {
    status: input.afterIssueCount === 0
      ? "verified_resolved"
      : input.afterIssueCount < input.beforeIssueCount
        ? "improved"
        : "still_present",
    beforeIssueCount: input.beforeIssueCount,
    afterIssueCount: input.afterIssueCount,
    evidence: "two_distinct_audits",
  };
}
