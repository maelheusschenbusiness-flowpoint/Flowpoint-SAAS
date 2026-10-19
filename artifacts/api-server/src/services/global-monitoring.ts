import type { BSMonitor } from "./betterstack-service.js";

export interface RegionalMonitorEntry {
  region: string;
  monitorId: string;
  monitorName: string;
  status: string;
  uptimePercentage: number | null;
}

/**
 * Summarize only regions explicitly configured on real Better Stack monitors.
 * Better Stack reports monitor-level, not region-level, health here; keep that
 * distinction explicit rather than implying independent per-region checks.
 */
export function summarizeGlobalMonitoring(monitors: BSMonitor[]) {
  const entries: RegionalMonitorEntry[] = [];
  for (const monitor of monitors) {
    const regions = Array.isArray(monitor.attributes.regions) ? monitor.attributes.regions : [];
    for (const rawRegion of regions) {
      const region = String(rawRegion || "").trim();
      if (!region) continue;
      const parsedUptime = Number(monitor.attributes.uptime_percentage);
      entries.push({
        region,
        monitorId: monitor.id,
        monitorName: monitor.attributes.name || monitor.attributes.url || monitor.id,
        status: monitor.attributes.paused ? "paused" : String(monitor.attributes.status || "unknown"),
        uptimePercentage: Number.isFinite(parsedUptime) ? parsedUptime : null,
      });
    }
  }

  const byRegion = new Map<string, RegionalMonitorEntry[]>();
  for (const entry of entries) {
    const rows = byRegion.get(entry.region) ?? [];
    rows.push(entry);
    byRegion.set(entry.region, rows);
  }

  return {
    configuredRegionCount: byRegion.size,
    configuredMonitorCount: new Set(entries.map(entry => entry.monitorId)).size,
    regions: [...byRegion.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
            .map(([region, monitorsInRegion]) => {
        const health = monitorsInRegion.reduce((counts, monitor) => {
          const status = monitor.status.toLowerCase();
          if (["up", "operational", "healthy"].includes(status)) counts.operational++;
          else if (["degraded", "degraded_performance"].includes(status)) counts.degraded++;
          else if (["down", "error"].includes(status)) counts.down++;
          else if (status === "paused") counts.paused++;
          else counts.unknown++;
          return counts;
        }, { operational: 0, degraded: 0, down: 0, paused: 0, unknown: 0 });
        return { region, monitorCount: monitorsInRegion.length, health, monitors: monitorsInRegion };
      }),
    note: "Health and uptime are monitor-level aggregates from Better Stack, not independent per-region measurements.",
  };
}
