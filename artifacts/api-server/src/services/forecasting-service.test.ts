import { describe, expect, it } from "vitest";
import { projectGA4DailyMetric } from "./forecasting-service.js";

describe("GA4 forecast metrics", () => {
  it("does not project a metric from fewer than 14 observed days", () => {
    expect(projectGA4DailyMetric(Array(13).fill(20), 30, 1)).toBe(0);
  });

  it("projects conversions from the measured recent baseline", () => {
    expect(projectGA4DailyMetric(Array(14).fill(10), 30, 1)).toBe(10);
    expect(projectGA4DailyMetric(Array(14).fill(10), 30, 0.9)).toBe(9);
  });

  it("rounds revenue to cents and never emits a negative projection", () => {
    expect(projectGA4DailyMetric(Array(14).fill(12.345), 30, 1, 2)).toBe(12.35);
    expect(projectGA4DailyMetric(Array(14).fill(0), 30, 0.9, 2)).toBe(0);
  });

  it("limits the trend extrapolation to five percent per day", () => {
    const increasing = [...Array(14).fill(0), ...Array(14).fill(100)];
    expect(projectGA4DailyMetric(increasing, 1, 1)).toBe(105);
  });
});
