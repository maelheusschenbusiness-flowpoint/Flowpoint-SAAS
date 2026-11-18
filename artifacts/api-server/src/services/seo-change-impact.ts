export type SEOAuditSnapshot = {
  auditId: string;
  siteUrl: string;
  capturedAt: string;
  score: number;
  criticalIssues: number;
  speed: number;
  status: string;
};

export type SEOChangeImpactSettings = {
  lookbackDays: number;
  minimumScoreChange: number;
};

export const DEFAULT_SEO_CHANGE_IMPACT_SETTINGS: SEOChangeImpactSettings = {
  lookbackDays: 30,
  minimumScoreChange: 0,
};

export function validateSEOChangeImpactSettings(value: unknown): SEOChangeImpactSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input["lookbackDays"]) || Number(input["lookbackDays"]) < 7 || Number(input["lookbackDays"]) > 365) return null;
  if (!Number.isInteger(input["minimumScoreChange"]) || Number(input["minimumScoreChange"]) < 0 || Number(input["minimumScoreChange"]) > 100) return null;
  return {
    lookbackDays: Number(input["lookbackDays"]),
    minimumScoreChange: Number(input["minimumScoreChange"]),
  };
}

export function normalizeSEOChangeImpactSettings(value: unknown): SEOChangeImpactSettings {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return DEFAULT_SEO_CHANGE_IMPACT_SETTINGS; }
  }
  return validateSEOChangeImpactSettings(value) ?? DEFAULT_SEO_CHANGE_IMPACT_SETTINGS;
}

export function compareSEOAuditSnapshots(before: SEOAuditSnapshot, after: SEOAuditSnapshot) {
  return {
    siteUrl: after.siteUrl,
    beforeAuditId: before.auditId,
    afterAuditId: after.auditId,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    beforeScore: before.score,
    afterScore: after.score,
    scoreDelta: after.score - before.score,
    beforeCriticalIssues: before.criticalIssues,
    afterCriticalIssues: after.criticalIssues,
    criticalIssueDelta: after.criticalIssues - before.criticalIssues,
    beforeSpeed: before.speed,
    afterSpeed: after.speed,
    speedDelta: after.speed - before.speed,
    hasMeasuredChange: before.auditId !== after.auditId,
  };
}

export function buildSEOChangeImpacts(
  snapshots: SEOAuditSnapshot[],
  settings: SEOChangeImpactSettings,
) {
  const bySite = new Map<string, SEOAuditSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!["ok", "warn"].includes(snapshot.status) || !snapshot.siteUrl) continue;
    const rows = bySite.get(snapshot.siteUrl) ?? [];
    rows.push(snapshot);
    bySite.set(snapshot.siteUrl, rows);
  }

  const comparisons = [];
  for (const [siteUrl, rows] of bySite) {
    rows.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    if (rows.length < 2) continue;
    const comparison = compareSEOAuditSnapshots(rows[1]!, rows[0]!);
    if (
      settings.minimumScoreChange > 0 &&
      Math.abs(comparison.scoreDelta) < settings.minimumScoreChange &&
      comparison.criticalIssueDelta === 0 &&
      comparison.speedDelta === 0
    ) continue;
    comparisons.push({ ...comparison, siteUrl });
  }

  return comparisons.sort((a, b) =>
    Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta) ||
    a.siteUrl.localeCompare(b.siteUrl),
  );
}
