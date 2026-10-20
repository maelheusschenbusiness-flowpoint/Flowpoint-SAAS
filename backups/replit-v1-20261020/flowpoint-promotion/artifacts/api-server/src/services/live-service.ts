/**
 * live-service.ts
 * Thin wrapper around ga4-service for Live/Realtime page data.
 * Never returns synthetic/fake data — returns empty shapes on GA4 failure.
 */
import { isGA4Connected, getGA4Realtime } from "./ga4-service.js";

export async function getLiveStatus(orgId: string): Promise<{
  connected: boolean;
  source: "ga4";
}> {
  const connected = await isGA4Connected(orgId).catch(() => false);
  return { connected, source: "ga4" };
}

export async function getLiveRealtime(orgId: string): Promise<{
  connected: boolean;
  source: "ga4";
  realtime: {
    activeUsers: number;
    rows: unknown[];
  };
}> {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) {
    return { connected: false, source: "ga4", realtime: { activeUsers: 0, rows: [] } };
  }

  const realtime = await getGA4Realtime(orgId).catch(() => ({
    activeUsers: 0,
    rows: [],
  }));

  return {
    connected: true,
    source: "ga4",
    realtime: {
      activeUsers: (realtime as { activeUsers?: number }).activeUsers ?? 0,
      rows: (realtime as { rows?: unknown[] }).rows ?? [],
    },
  };
}
