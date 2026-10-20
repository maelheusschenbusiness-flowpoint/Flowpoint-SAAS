/**
 * audience-service.ts
 * Thin wrapper around ga4-service for Audience page data.
 * Never returns synthetic/fake data — returns empty shapes on GA4 failure.
 */
import {
  isGA4Connected,
  getGA4Overview,
  getGA4Audience,
} from "./ga4-service.js";

export async function getAudienceStatus(orgId: string): Promise<{
  connected: boolean;
  source: "ga4";
}> {
  const connected = await isGA4Connected(orgId).catch(() => false);
  return { connected, source: "ga4" };
}

export async function getAudienceData(
  orgId: string,
  startDate: string,
  endDate: string
): Promise<{
  connected: boolean;
  source: "ga4";
  audience: {
    devices:     { rows: unknown[] };
    geo:         { rows: unknown[] };
    newVsReturn: { rows: unknown[] };
  };
  overview: Record<string, unknown> | null;
}> {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) {
    return {
      connected: false,
      source: "ga4",
      audience: { devices: { rows: [] }, geo: { rows: [] }, newVsReturn: { rows: [] } },
      overview: null,
    };
  }

  const [overview, audience] = await Promise.all([
    getGA4Overview(orgId, startDate, endDate).catch(() => null),
    getGA4Audience(orgId, startDate, endDate).catch(() => ({
      devices: { rows: [] },
      geo: { rows: [] },
      newVsReturn: { rows: [] },
    })),
  ]);

  return {
    connected: true,
    source: "ga4",
    audience,
    overview: overview as Record<string, unknown> | null,
  };
}
