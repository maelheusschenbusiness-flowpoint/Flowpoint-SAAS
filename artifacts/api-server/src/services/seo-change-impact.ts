export type SEOIssueSnapshot = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  affectedPages: number;
};

export type SEOAuditSnapshot = {
  auditId: string;
  capturedAt: string;
  score: number;
  issues: SEOIssueSnapshot[];
};

export function compareSEOAuditSnapshots(before: SEOAuditSnapshot, after: SEOAuditSnapshot) {
  const beforeIssues = new Map(before.issues.map(issue => [issue.code, issue]));
  const afterIssues = new Map(after.issues.map(issue => [issue.code, issue]));
  const resolved: SEOIssueSnapshot[] = [];
  const introduced: SEOIssueSnapshot[] = [];
  const changed: Array<{ code: string; beforePages: number; afterPages: number; severity: SEOIssueSnapshot["severity"] }> = [];

  for (const [code, issue] of beforeIssues) {
    const current = afterIssues.get(code);
    if (!current) {
      resolved.push(issue);
    } else if (current.affectedPages !== issue.affectedPages) {
      changed.push({
        code,
        beforePages: issue.affectedPages,
        afterPages: current.affectedPages,
        severity: current.severity,
      });
    }
  }
  for (const [code, issue] of afterIssues) {
    if (!beforeIssues.has(code)) introduced.push(issue);
  }

  return {
    beforeAuditId: before.auditId,
    afterAuditId: after.auditId,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    scoreDelta: after.score - before.score,
    resolved,
    introduced,
    changed,
    hasMeasuredChange: before.auditId !== after.auditId,
  };
}
