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

export type PublicAuditPlan = "Standard" | "Pro" | "Ultra";

export type PublicAuditPlanOption = {
  plan: PublicAuditPlan;
  priceEur: number;
  href: string;
  monthlyLimits: {
    audits: number;
    monitors: number;
    pdfReports: number;
  };
  features: string[];
};

export const PUBLIC_AUDIT_PLAN_CATALOG: PublicAuditPlanOption[] = [
  {
    plan: "Standard",
    priceEur: 29,
    href: "/pricing#plan-standard",
    monthlyLimits: { audits: 30, monitors: 10, pdfReports: 30 },
    features: [
      "Automated SEO audits",
      "Uptime monitoring",
      "Monthly PDF reports",
    ],
  },
  {
    plan: "Pro",
    priceEur: 79,
    href: "/pricing#plan-pro",
    monthlyLimits: { audits: 300, monitors: 50, pdfReports: 300 },
    features: [
      "Monitoring checks every 5 minutes",
      "Advanced competitor analysis",
      "Weekly and scheduled reports",
      "90-day history",
    ],
  },
  {
    plan: "Ultra",
    priceEur: 149,
    href: "/pricing#plan-ultra",
    monthlyLimits: { audits: 1_000, monitors: 300, pdfReports: 1_000 },
    features: [
      "Full white-label reporting",
      "Multiple workspaces and sites",
      "Advanced competitor benchmarking",
      "365-day data retention",
    ],
  },
];

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
    status: "recommended" | "compare";
    plan: PublicAuditPlan | null;
    priceEur: number | null;
    reasons: string[];
    features: string[];
    href: string;
    comparisonPlans: PublicAuditPlanOption[];
  };
  quota: PublicAuditQuota;
};
