export const PUBLIC_AUDIT_CATEGORIES = [
  { key: "seo", title: "SEO" },
  { key: "performance", title: "Performance" },
  { key: "accessibility", title: "Accessibility" },
  { key: "security", title: "Security & Trust" },
  { key: "mobile", title: "Mobile Experience" },
  { key: "conversion", title: "Conversion & UX" },
  { key: "technical", title: "Technical Health" },
  { key: "content", title: "Content Quality" },
] as const;

export type PublicAuditCategoryKey =
  (typeof PUBLIC_AUDIT_CATEGORIES)[number]["key"];
export type PublicAuditStatus =
  | "passed"
  | "failed"
  | "warning"
  | "not_measured";
export type PublicAuditSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";
export type PublicAuditDifficulty = "easy" | "moderate" | "hard" | null;

export type PublicAuditCheck = {
  id: string;
  title: string;
  status: PublicAuditStatus;
  severity: PublicAuditSeverity;
  evidence: string | null;
  explanation: string;
  impact: string;
  recommendation: string;
  priority: number;
  difficulty: PublicAuditDifficulty;
};

export type PublicAuditCategory = {
  key: PublicAuditCategoryKey;
  title: string;
  score: number | null;
  status: "measured" | "partial" | "not_measured";
  coverage: {
    measuredChecks: number;
    totalChecks: number;
  };
  summary: string;
  checks: PublicAuditCheck[];
};

export type PublicAuditAction = {
  title: string;
  category: string;
  priority: number;
  severity: PublicAuditSeverity;
  evidence: string | null;
  explanation: string;
  impact: string;
  difficulty: PublicAuditDifficulty;
  reason: string;
};

export type PublicAuditQuota = {
  remaining: number;
  limit: number;
  resetAt: string;
};

export type PublicAuditReport = {
  url: string;
  finalUrl: string;
  checkedAt: string;
  overallScore: number | null;
  coverage: {
    measuredChecks: number;
    totalChecks: number;
    scoredCategories: number;
    totalCategories: number;
  };
  categories: PublicAuditCategory[];
  actionPlan: PublicAuditAction[];
  recommendation: {
    plan: "Standard";
    priceEur: number;
    reason: string;
    href: string;
    planLinks: Array<{
      plan: "Standard" | "Pro" | "Ultra";
      href: string;
    }>;
  };
  quota: PublicAuditQuota;
};
