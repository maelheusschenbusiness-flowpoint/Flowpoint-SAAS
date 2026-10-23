export type TechnicalSEOIssue = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  affectedPages: number;
};

export type FixVerificationStatus =
  | "verified_resolved"
  | "improved"
  | "still_present"
  | "baseline_issue_not_found"
  | "not_comparable";

const severityRank: Record<TechnicalSEOIssue["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function verifyTechnicalSEOFix(input: {
  issueCode: string;
  beforeAuditId: string;
  afterAuditId: string;
  beforeIssues: TechnicalSEOIssue[];
  afterIssues: TechnicalSEOIssue[];
}): {
  status: FixVerificationStatus;
  issueCode: string;
  beforeAffectedPages: number | null;
  afterAffectedPages: number | null;
  evidence: "two_distinct_audits" | "insufficient_audit_evidence";
} {
  if (!input.beforeAuditId || !input.afterAuditId || input.beforeAuditId === input.afterAuditId) {
    return {
      status: "not_comparable",
      issueCode: input.issueCode,
      beforeAffectedPages: null,
      afterAffectedPages: null,
      evidence: "insufficient_audit_evidence",
    };
  }

  const before = input.beforeIssues.find(issue => issue.code === input.issueCode);
  if (!before) {
    return {
      status: "baseline_issue_not_found",
      issueCode: input.issueCode,
      beforeAffectedPages: null,
      afterAffectedPages: null,
      evidence: "two_distinct_audits",
    };
  }

  const after = input.afterIssues.find(issue => issue.code === input.issueCode);
  if (!after) {
    return {
      status: "verified_resolved",
      issueCode: input.issueCode,
      beforeAffectedPages: before.affectedPages,
      afterAffectedPages: 0,
      evidence: "two_distinct_audits",
    };
  }

  const improved = after.affectedPages < before.affectedPages
    || severityRank[after.severity] < severityRank[before.severity];

  return {
    status: improved ? "improved" : "still_present",
    issueCode: input.issueCode,
    beforeAffectedPages: before.affectedPages,
    afterAffectedPages: after.affectedPages,
    evidence: "two_distinct_audits",
  };
}
