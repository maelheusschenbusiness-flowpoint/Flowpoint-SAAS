import { getValidToken } from "./google-service.js";
import { GBP_PERFORMANCE_METRICS } from "./gbp-performance-addon.js";

/**
 * Lecture des series quotidiennes de l'API Business Profile Performance (v1,
 * fetchMultiDailyMetricsTimeSeries). Reprise de `getPerformance` de Test-Replit sous un
 * nouveau nom, dans un fichier a part : le `getPerformance` de Flowpoint (consomme par
 * routes/google.ts, appelle l'ancien point de terminaison et avale les erreurs) n'est pas
 * modifie. Les erreurs du fournisseur sont remontees (jamais de serie vide inventee).
 */
export async function getGbpPerformanceSeries(
  orgId: string,
  locationName: string,
  opts: { startTime: string; endTime: string },
): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  const start = new Date(opts.startTime);
  const end = new Date(opts.endTime);
  const locationId = locationName.match(/(?:^|\/)locations\/([^/]+)$/)?.[1]
    ?? (/^[^/]+$/.test(locationName) ? locationName : "");
  if (!locationId || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Invalid Google Business Profile performance request");
  }
  const params = new URLSearchParams();
  for (const metric of GBP_PERFORMANCE_METRICS) params.append("dailyMetrics", metric);
  for (const [prefix, date] of [["start_date", start], ["end_date", end]] as const) {
    params.set(`dailyRange.${prefix}.year`, String(date.getUTCFullYear()));
    params.set(`dailyRange.${prefix}.month`, String(date.getUTCMonth() + 1));
    params.set(`dailyRange.${prefix}.day`, String(date.getUTCDate()));
  }
  const url = `https://businessprofileperformance.googleapis.com/v1/locations/${encodeURIComponent(locationId)}:fetchMultiDailyMetricsTimeSeries?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`Google Business Profile Performance API returned HTTP ${res.status}`);
  }
  const data = await res.json() as {
    multiDailyMetricTimeSeries?: Array<{
      dailyMetricTimeSeries?: Array<{ dailyMetric?: string; timeSeries?: unknown }>;
    }>;
  };
  return (data.multiDailyMetricTimeSeries ?? []).flatMap((group) => group.dailyMetricTimeSeries ?? []);
}
