type AuditRow = { url?: unknown; score?: unknown; status?: unknown; created_at?: unknown };
type MonitorRow = { url?: unknown; name?: unknown; status?: unknown; uptime?: unknown; response_time?: unknown };

function domainOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function measuredNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildExecutiveReportFacts(audits: AuditRow[], monitors: MonitorRow[]) {
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
  const scores = validAudits.map(row => row.score);
  const uptime = validMonitors.map(row => row.uptime).filter((value): value is number => value !== null);
  return {
    audits: validAudits,
    monitors: validMonitors,
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
