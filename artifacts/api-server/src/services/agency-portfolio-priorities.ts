export type PortfolioSiteSnapshot = {
  siteId: string;
  domain: string;
  currentScore: number;
  previousScore: number | null;
  criticalIssues: number;
  monthlyOrganicClicks: number | null;
  priorityWeight: number;
};

export type PortfolioPriority = PortfolioSiteSnapshot & {
  scoreChange: number | null;
  priority: "urgent" | "focus" | "stable";
  reasons: string[];
};

export function rankAgencyPortfolioPriorities(sites: PortfolioSiteSnapshot[]): PortfolioPriority[] {
  const priorities = sites.map(site => {
    if (
      !site.siteId.trim() || !site.domain.trim()
      || !Number.isFinite(site.currentScore) || site.currentScore < 0 || site.currentScore > 100
      || (site.previousScore !== null && (!Number.isFinite(site.previousScore) || site.previousScore < 0 || site.previousScore > 100))
      || !Number.isInteger(site.criticalIssues) || site.criticalIssues < 0
      || (site.monthlyOrganicClicks !== null && (!Number.isFinite(site.monthlyOrganicClicks) || site.monthlyOrganicClicks < 0))
      || !Number.isFinite(site.priorityWeight) || site.priorityWeight < 1 || site.priorityWeight > 5
    ) {
      throw new RangeError(`Invalid portfolio metrics for ${site.domain || site.siteId || "site"}`);
    }

    const scoreChange = site.previousScore === null ? null : site.currentScore - site.previousScore;
    const reasons: string[] = [];
    if (site.criticalIssues > 0) reasons.push(`${site.criticalIssues} critical technical issues`);
    if (scoreChange !== null && scoreChange <= -5) reasons.push(`SEO score fell by ${Math.abs(scoreChange)} points`);
    if (site.currentScore <= 60) reasons.push(`current SEO score is ${site.currentScore}/100`);

    const priority: PortfolioPriority["priority"] =
      site.criticalIssues > 0 || (scoreChange !== null && scoreChange <= -10)
      ? "urgent"
      : scoreChange !== null && scoreChange <= -5 || site.currentScore <= 60
        ? "focus"
        : "stable";

    return { ...site, scoreChange, priority, reasons };
  });

  const priorityRank = { urgent: 0, focus: 1, stable: 2 } as const;
  return priorities.sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority]
    || (a.scoreChange ?? 0) - (b.scoreChange ?? 0)
    || b.criticalIssues - a.criticalIssues
    || b.priorityWeight - a.priorityWeight
    || a.domain.localeCompare(b.domain),
  );
}

export type AgencyPortfolioSettings = {
  priorityWeights: Record<string, number>;
};

export const DEFAULT_AGENCY_PORTFOLIO_SETTINGS: AgencyPortfolioSettings = {
  priorityWeights: {},
};

const normalizedDomain = (value: string): string => {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export function normalizeAgencyPortfolioSettings(value: unknown): AgencyPortfolioSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_AGENCY_PORTFOLIO_SETTINGS;
  const raw = (value as Record<string, unknown>).priorityWeights;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_AGENCY_PORTFOLIO_SETTINGS;
  const priorityWeights: Record<string, number> = {};
  for (const [domain, weight] of Object.entries(raw).slice(0, 100)) {
    const normalized = normalizedDomain(domain);
    if (normalized && Number.isInteger(weight) && Number(weight) >= 1 && Number(weight) <= 5) {
      priorityWeights[normalized] = Number(weight);
    }
  }
  return { priorityWeights };
}

export function validateAgencyPortfolioSettings(value: unknown): AgencyPortfolioSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).priorityWeights;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > 100) return null;
  const priorityWeights: Record<string, number> = {};
  for (const [domain, weight] of entries) {
    const normalized = normalizedDomain(domain);
    if (!normalized || !Number.isInteger(weight) || Number(weight) < 1 || Number(weight) > 5) return null;
    priorityWeights[normalized] = Number(weight);
  }
  return { priorityWeights };
}
