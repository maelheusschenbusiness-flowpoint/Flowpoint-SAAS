export const GBP_PERFORMANCE_METRICS = [
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
] as const;

export type GbpPerformanceMetric = (typeof GBP_PERFORMANCE_METRICS)[number];

export interface GbpPerformanceSettings {
  locationId: string | null;
  periodDays: 7 | 30 | 90;
  goals: Partial<Record<GbpPerformanceMetric, number>>;
  alertDropPercent: number;
}

export const DEFAULT_GBP_PERFORMANCE_SETTINGS: GbpPerformanceSettings = {
  locationId: null,
  periodDays: 30,
  goals: {},
  alertDropPercent: 20,
};

export function parseGbpPerformanceSettings(value: unknown): GbpPerformanceSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const periodDays = input.periodDays;
  if (periodDays !== 7 && periodDays !== 30 && periodDays !== 90) return null;
  if (!Number.isInteger(input.alertDropPercent) || Number(input.alertDropPercent) < 5 || Number(input.alertDropPercent) > 80) {
    return null;
  }
  if (input.locationId !== null && (typeof input.locationId !== "string" || input.locationId.length > 200)) {
    return null;
  }
  if (!input.goals || typeof input.goals !== "object" || Array.isArray(input.goals)) return null;

  const goals: Partial<Record<GbpPerformanceMetric, number>> = {};
  for (const metric of GBP_PERFORMANCE_METRICS) {
    const goal = (input.goals as Record<string, unknown>)[metric];
    if (goal === undefined || goal === null || goal === "") continue;
    const number = Number(goal);
    if (!Number.isFinite(number) || number < 0 || number > 10_000_000) return null;
    goals[metric] = Math.floor(number);
  }
  return {
    locationId: input.locationId as string | null,
    periodDays,
    goals,
    alertDropPercent: Number(input.alertDropPercent),
  };
}

export function summarizeGbpMetrics(metrics: unknown): Record<string, number> {
  if (!Array.isArray(metrics)) return {};
  const summary: Record<string, number> = {};
  for (const item of metrics) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      dailyMetric?: unknown;
      timeSeries?: { datedValues?: Array<{ value?: unknown }> };
    };
    if (typeof row.dailyMetric !== "string" || !GBP_PERFORMANCE_METRICS.includes(row.dailyMetric as GbpPerformanceMetric)) continue;
    const total = (row.timeSeries?.datedValues ?? []).reduce((sum, value) => {
      const n = Number(value?.value);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    summary[row.dailyMetric] = (summary[row.dailyMetric] ?? 0) + total;
  }
  return summary;
}

export function calculateDropPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0 || current >= previous) return null;
  return Math.round(((previous - current) / previous) * 100);
}
