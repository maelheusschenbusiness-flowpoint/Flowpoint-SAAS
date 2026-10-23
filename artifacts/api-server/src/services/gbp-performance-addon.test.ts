import { describe, expect, it } from "vitest";
import {
  calculateDropPercent,
  parseGbpPerformanceSettings,
  summarizeGbpMetrics,
} from "./gbp-performance-addon.js";

describe("GBP Performance & Leads", () => {
  it("validates and normalizes persistent goals and alert settings", () => {
    expect(parseGbpPerformanceSettings({
      locationId: "location-1",
      periodDays: 30,
      goals: { CALL_CLICKS: "24", WEBSITE_CLICKS: 80, UNKNOWN: 10 },
      alertDropPercent: 25,
    })).toEqual({
      locationId: "location-1",
      periodDays: 30,
      goals: { CALL_CLICKS: 24, WEBSITE_CLICKS: 80 },
      alertDropPercent: 25,
    });
    expect(parseGbpPerformanceSettings({
      locationId: null, periodDays: 14, goals: {}, alertDropPercent: 20,
    })).toBeNull();
    expect(parseGbpPerformanceSettings({
      locationId: null, periodDays: 30, goals: { CALL_CLICKS: -1 }, alertDropPercent: 20,
    })).toBeNull();
  });

  it("summarizes only supported provider metrics and ignores invalid values", () => {
    expect(summarizeGbpMetrics([
      { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "3" }, { value: 4 }] } },
      { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: 2 }] } },
      { dailyMetric: "UNSUPPORTED", timeSeries: { datedValues: [{ value: 999 }] } },
    ])).toEqual({ CALL_CLICKS: 9 });
  });

  it("reports a decline only when there is a prior non-zero baseline", () => {
    expect(calculateDropPercent(60, 100)).toBe(40);
    expect(calculateDropPercent(120, 100)).toBeNull();
    expect(calculateDropPercent(0, 0)).toBeNull();
  });
});
