export type GA4ConversionPageRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

export type ConversionOpportunitySettings = {
  minimumSessions: number;
  maximumConversionRate: number;
};

export const DEFAULT_CONVERSION_OPPORTUNITY_SETTINGS: ConversionOpportunitySettings = {
  minimumSessions: 100,
  maximumConversionRate: 0.02,
};

export function normalizeConversionOpportunitySettings(input: unknown): ConversionOpportunitySettings {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const minimumSessions = Number(value["minimumSessions"]);
  const maximumConversionRate = Number(value["maximumConversionRate"]);
  return {
    minimumSessions: Number.isFinite(minimumSessions)
      ? Math.max(1, Math.min(1_000_000, Math.floor(minimumSessions)))
      : DEFAULT_CONVERSION_OPPORTUNITY_SETTINGS.minimumSessions,
    maximumConversionRate: Number.isFinite(maximumConversionRate)
      ? Math.max(0, Math.min(1, maximumConversionRate))
      : DEFAULT_CONVERSION_OPPORTUNITY_SETTINGS.maximumConversionRate,
  };
}

function metric(row: GA4ConversionPageRow, index: number): number {
  const value = Number(row.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function findConversionOpportunities(
  rows: GA4ConversionPageRow[],
  settingsInput: unknown,
) {
  const settings = normalizeConversionOpportunitySettings(settingsInput);
  return rows.map(row => {
    const sessions = metric(row, 0);
    const conversions = metric(row, 2);
    const revenue = metric(row, 3);
    const conversionRate = sessions > 0 ? conversions / sessions : 0;
    return {
      landingPage: String(row.dimensionValues?.[0]?.value ?? ""),
      sessions: Math.round(sessions),
      conversions: Math.round(conversions),
      revenue,
      conversionRate,
    };
  }).filter(page =>
    page.landingPage.length > 0
    && page.sessions >= settings.minimumSessions
    && page.conversionRate <= settings.maximumConversionRate,
  ).sort((a, b) =>
    (b.sessions * (settings.maximumConversionRate - b.conversionRate))
    - (a.sessions * (settings.maximumConversionRate - a.conversionRate)),
  ).slice(0, 50);
}
