export type PortfolioSiteSnapshot = {
  siteId: string;
  domain: string;
  currentScore: number;
  previousScore: number | null;
  criticalIssues: number;
  monthlyOrganicSessions: number;
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
      || !Number.isFinite(site.monthlyOrganicSessions) || site.monthlyOrganicSessions < 0
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
