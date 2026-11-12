type AuditRow = { url?: unknown; score?: unknown; status?: unknown; created_at?: unknown };
type MonitorRow = { url?: unknown; name?: unknown; status?: unknown; uptime?: unknown; response_time?: unknown };
type GA4OverviewData = { totals?: Array<{ metricValues?: Array<{ value?: unknown }> }> };
type GSCPageRow = { page?: unknown; clicks?: unknown; impressions?: unknown; avg_position?: unknown };
type ExecutiveAnalyticsInput = { ga4?: GA4OverviewData | null; searchConsolePages?: unknown[] | null };

function domainOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function measuredNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validHttpPage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function buildExecutiveAnalyticsFacts(input: ExecutiveAnalyticsInput = {}) {
  const ga4Values = input.ga4?.totals?.[0]?.metricValues ?? [];
  const ga4Metric = (index: number) => measuredNumber(ga4Values[index]?.value);
  const ga4HasData = ga4Values.some(metric => measuredNumber(metric?.value) !== null);
  const ga4 = {
    status: ga4HasData ? "observed" : "unavailable",
    source: "GA4 property-wide aggregate",
    periodDays: 30,
    sessions: ga4HasData ? ga4Metric(0) : null,
    users: ga4HasData ? ga4Metric(1) : null,
    pageViews: ga4HasData ? ga4Metric(6) : null,
    conversions: ga4HasData ? ga4Metric(7) : null,
  };
  const searchPages = (input.searchConsolePages ?? []).flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as GSCPageRow;
    const page = validHttpPage(row.page);
    if (!page) return [];
    return [{ page: page.slice(0, 200), clicks: measuredNumber(row.clicks), impressions: measuredNumber(row.impressions), averagePosition: measuredNumber(row.avg_position) }];
  }).slice(0, 5);
  const clicksComplete = searchPages.length > 0 && searchPages.every(row => row.clicks !== null);
  const impressionsComplete = searchPages.length > 0 && searchPages.every(row => row.impressions !== null);
  const sampledClicks = clicksComplete ? searchPages.reduce((sum, row) => sum + row.clicks!, 0) : null;
  const sampledImpressions = impressionsComplete ? searchPages.reduce((sum, row) => sum + row.impressions!, 0) : null;
  const positionsComplete = impressionsComplete && searchPages.every(row => row.averagePosition !== null);
  const weightedAveragePosition = positionsComplete && sampledImpressions !== null && sampledImpressions > 0
    ? Math.round(searchPages.reduce((sum, row) => sum + row.averagePosition! * row.impressions!, 0) / sampledImpressions * 100) / 100 : null;
  const clickThroughRate = sampledClicks !== null && sampledImpressions !== null && sampledImpressions > 0
    ? Math.round(sampledClicks / sampledImpressions * 10000) / 10000 : null;
  const gscHasData = sampledClicks !== null || sampledImpressions !== null || weightedAveragePosition !== null;
  const searchConsole = {
    status: gscHasData ? "observed" : "unavailable",
    source: "Google Search Console synced pages",
    periodDays: 28, scope: "top_5_synced_pages", pagesIncluded: searchPages.length,
    sampledClicks, sampledImpressions, weightedAveragePosition, clickThroughRate, pages: searchPages,
  };
  return { ga4, searchConsole };
}

export function buildExecutiveReportFacts(audits: AuditRow[], monitors: MonitorRow[], analyticsInput: ExecutiveAnalyticsInput = {}) {
  const validAudits = audits.slice(0, 8).flatMap(row => {
    const score = measuredNumber(row.score);
    if (score === null || score < 0 || score > 100) return [];
    return [{
      domain: domainOf(row.url),
      score: Math.round(score),
      status: typeof row.status === "string" ? row.status : null,
      date: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    }];
  });
  const validMonitors = monitors.slice(0, 12).map(row => {
    const uptime = measuredNumber(row.uptime);
    const responseTime = measuredNumber(row.response_time);
    return {
      name: typeof row.name === "string" ? row.name.slice(0, 100) : null,
      domain: domainOf(row.url),
      status: typeof row.status === "string" ? row.status : null,
      uptime: uptime !== null && uptime >= 0 && uptime <= 100 ? Math.round(uptime * 100) / 100 : null,
      responseTimeMs: responseTime !== null && responseTime >= 0 ? Math.round(responseTime) : null,
    };
  });
  const analytics = buildExecutiveAnalyticsFacts(analyticsInput);
  const scores = validAudits.map(row => row.score);
  const uptime = validMonitors.map(row => row.uptime).filter((value): value is number => value !== null);
  return {
    audits: validAudits,
    monitors: validMonitors,
    analytics,
    measured: {
      auditsIncluded: validAudits.length,
      latestAuditScore: scores[0] ?? null,
      previousAuditScore: scores[1] ?? null,
      scoreChange: scores.length > 1 ? scores[0]! - scores[1]! : null,
      monitorsIncluded: validMonitors.length,
      monitorsDown: validMonitors.filter(row => row.status?.toLowerCase() === "down").length,
      averageUptime: uptime.length ? Math.round(uptime.reduce((a, b) => a + b, 0) / uptime.length * 100) / 100 : null,
    },
  };
}
