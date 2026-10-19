import { describe, expect, it } from "vitest";
import { summarizeGlobalMonitoring } from "./global-monitoring.js";
import type { BSMonitor } from "./betterstack-service.js";
import { ADDON_DEFINITIONS, COMING_SOON_ADDONS, getAddonAvailability, getAddonStatus } from "../lib/plans.js";

function monitor(id: string, regions: string[], status = "operational", uptime?: string): BSMonitor {
  return {
    id,
    type: "monitor",
    attributes: {
      url: `https://${id}.example`,
      name: id,
      monitor_type: "status",
      status,
      request_timeout: 10,
      verify_ssl: true,
      check_frequency: 60,
      regions,
      paused: false,
      recovery_period: 0,
      follow_redirects: true,
      remember_cookies: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...(uptime === undefined ? {} : { uptime_percentage: uptime }),
    },
  };
}

describe("global monitoring regional coverage summary", () => {
  it("keeps the selected batch within proposed prices and unavailable before approval", () => {
    const selected = ["globalMonitoring", "agencyPacks", "aiWorkspaceLaunch"];
    expect(selected.map(key => ADDON_DEFINITIONS[key].priceEur)).toEqual([15, 12, 15]);
    for (const key of selected) {
      expect(COMING_SOON_ADDONS.has(key)).toBe(true);
      expect(getAddonAvailability(key)).toBe("coming_soon");
      expect(getAddonStatus(key)).toBe("coming_soon");
    }
  });

  it("groups actual configured regions and retains monitor-level status", () => {
    const summary = summarizeGlobalMonitoring([
      monitor("store", ["us", "eu"], "operational", "99.9"),
      monitor("api", ["eu"], "down"),
    ]);
    expect(summary.configuredRegionCount).toBe(2);
    expect(summary.configuredMonitorCount).toBe(2);
    expect(summary.regions).toEqual([
      { region: "eu", monitorCount: 2, monitors: expect.any(Array) },
      { region: "us", monitorCount: 1, monitors: expect.any(Array) },
    ]);
    expect(summary.regions[0].monitors[1].status).toBe("down");
    expect(summary.regions[0].monitors[1].uptimePercentage).toBeNull();
    expect(summary.regions[0].health).toEqual({ operational: 1, degraded: 0, down: 1, paused: 0, unknown: 0 });
    expect(summary.note).toContain("not independent per-region measurements");
  });

  it("returns an honest empty result when no regions are configured", () => {
    expect(summarizeGlobalMonitoring([monitor("site", [])])).toMatchObject({
      configuredRegionCount: 0,
      configuredMonitorCount: 0,
      regions: [],
    });
  });
});
