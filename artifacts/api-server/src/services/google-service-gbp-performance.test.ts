import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));

import { encryptToken, getPerformance } from "./google-service.js";

function mockGoogleToken() {
  const client = {
    query: vi.fn().mockResolvedValue({
      rows: [{
        access_token: encryptToken("test-access-token"),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      }],
    }),
    release: vi.fn(),
  };
  mocks.connect.mockResolvedValue(client);
}

describe("Google Business Profile Performance API request", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGoogleToken();
  });

  it("uses the v1 location resource, supported metrics, and snake_case date fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: [
          { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "7" }] } },
          { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ value: "12" }] } },
        ],
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPerformance("org-1", "accounts/account-1/locations/location-1", {
      startTime: "2026-10-01T00:00:00.000Z",
      endTime: "2026-10-08T00:00:00.000Z",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/locations/location-1:fetchMultiDailyMetricsTimeSeries?",
    );
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.getAll("dailyMetrics")).toEqual([
      "CALL_CLICKS",
      "WEBSITE_CLICKS",
      "BUSINESS_DIRECTION_REQUESTS",
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
    ]);
    expect(url.searchParams.get("dailyRange.start_date.day")).toBe("1");
    expect(url.searchParams.get("dailyRange.end_date.day")).toBe("8");
    expect(result).toEqual([
      { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "7" }] } },
      { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ value: "12" }] } },
    ]);
  });

  it("surfaces provider errors instead of silently returning fabricated empty metrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));

    await expect(getPerformance("org-1", "locations/location-1", {
      startTime: "2026-10-01T00:00:00.000Z",
      endTime: "2026-10-08T00:00:00.000Z",
    })).rejects.toThrow("HTTP 403");
  });
});
