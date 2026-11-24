import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect, query: vi.fn() } }));

import {
  GoogleApiError, buildPerformanceUrl, buildV4LocationName, encryptToken, getAccounts, getLocations,
  getPerformance, mapLocationToRow, normalizeGbpAccountId, parseStarRating, replyToReview, syncAll,
} from "./google-service.js";

const writes: Array<{ sql: string; params: unknown[] }> = [];

function mockDb(opts: { connected?: boolean } = {}) {
  writes.length = 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM google_tokens/.test(sql)) {
        return opts.connected === false ? { rows: [] } : {
          rows: [{ access_token: encryptToken("tok"), expires_at: new Date(Date.now() + 600_000).toISOString() }],
        };
      }
      if (/FROM google_accounts/.test(sql)) return { rows: [] };
      writes.push({ sql, params });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  mocks.connect.mockResolvedValue(client);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const googleError = (status: number, error: Record<string, unknown>) => json({ error }, status);

describe("GBP getLocations (Business Information API)", () => {
  beforeEach(() => { vi.restoreAllMocks(); mockDb(); });

  it("calls the Business Information API with readMask and follows nextPageToken", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ locations: [{ name: "locations/1" }, { name: "locations/2" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json({ locations: [{ name: "locations/3" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const locs = await getLocations("org-1", "accounts/123");

    expect(locs).toHaveLength(3);
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.origin).toBe("https://mybusinessbusinessinformation.googleapis.com");
    expect(first.pathname).toBe("/v1/accounts/123/locations");
    expect(first.searchParams.get("readMask")).toContain("storefrontAddress");
    expect(first.searchParams.get("readMask")).toContain("websiteUri");
    expect(first.searchParams.get("pageToken")).toBeNull();
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("pageToken")).toBe("p2");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("rejects the legacy 'primary' placeholder instead of calling Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getLocations("org-1", "primary")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(normalizeGbpAccountId("accounts/9")).toBe("9");
  });

  it("propagates 'API not enabled' as a typed error (never a silent [])", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(googleError(403, {
      code: 403, status: "PERMISSION_DENIED",
      message: "My Business Business Information API has not been used in project 1 before or it is disabled.",
      details: [{ reason: "SERVICE_DISABLED" }],
    })));
    const err = await getLocations("org-1", "123").catch(e => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "API_NOT_ENABLED", status: 403, reason: "SERVICE_DISABLED" });
  });

  it("maps HTTP 429 / quota 0 to QUOTA_EXCEEDED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(googleError(429, {
      code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for quota metric 'Requests' ... limit 0",
    })));
    await expect(getAccounts("org-1")).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", status: 429 });
  });

  it("reports NOT_CONNECTED when the org has no Google token", async () => {
    mockDb({ connected: false });
    vi.stubGlobal("fetch", vi.fn());
    await expect(getAccounts("org-1")).rejects.toMatchObject({ code: "NOT_CONNECTED", status: 401 });
  });
});

describe("GBP mapping and request builders", () => {
  it("maps a Business Information location to a google_locations row", () => {
    const row = mapLocationToRow("org-1", "accounts/123", {
      name: "locations/456", title: "Chez Marcel", websiteUri: "https://marcel.fr",
      phoneNumbers: { primaryPhone: "+33 1 02 03 04 05" },
      categories: { primaryCategory: { name: "categories/gcid:bakery", displayName: "Boulangerie" } },
      latlng: { latitude: 48.85, longitude: 2.35 },
    }, { averageRating: 4.6, totalReviewCount: 87 });
    expect(row).toMatchObject({
      id: "org-1_locations/456", locationId: "456", name: "Chez Marcel", primaryCategory: "Boulangerie",
      rating: 4.6, reviewsCount: 87, phone: "+33 1 02 03 04 05", website: "https://marcel.fr", lat: 48.85, lng: 2.35,
    });
    expect(row.rawData).toMatchObject({
      name: "locations/456", v4Name: "accounts/123/locations/456",
      primaryCategory: { displayName: "Boulangerie" },
    });
  });

  it("builds the v4 name and parses star ratings enums", () => {
    expect(buildV4LocationName("accounts/1", "locations/2")).toBe("accounts/1/locations/2");
    expect(parseStarRating("FIVE")).toBe(5);
    expect(parseStarRating("STAR_RATING_UNSPECIFIED")).toBe(0);
  });

  it("builds a fetchMultiDailyMetricsTimeSeries URL with UTC snake_case dates", () => {
    const url = new URL(buildPerformanceUrl("locations/456", "2026-03-01T23:30:00Z", "2026-03-31T00:10:00Z", ["CALL_CLICKS", "WEBSITE_CLICKS"]));
    expect(url.pathname).toBe("/v1/locations/456:fetchMultiDailyMetricsTimeSeries");
    expect(url.searchParams.getAll("dailyMetrics")).toEqual(["CALL_CLICKS", "WEBSITE_CLICKS"]);
    expect(url.searchParams.get("dailyRange.start_date.day")).toBe("1");
    expect(url.searchParams.get("dailyRange.end_date.month")).toBe("3");
    expect(url.searchParams.has("dailyMetric")).toBe(false);
    expect(() => buildPerformanceUrl("", "2026-03-01", "2026-03-02", [])).toThrow(GoogleApiError);
  });

  it("getPerformance flattens the multi-series response and raises on 403", async () => {
    mockDb();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({
      multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "3" }] } }] }],
    })));
    const series = await getPerformance("org-1", "accounts/1/locations/456", { startTime: "2026-03-01", endTime: "2026-03-07" });
    expect(series).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(googleError(403, { code: 403, status: "PERMISSION_DENIED", message: "denied" })));
    await expect(getPerformance("org-1", "locations/456", { startTime: "2026-03-01", endTime: "2026-03-07" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("replyToReview targets accounts/{a}/locations/{l}/reviews/{id}/reply", async () => {
    mockDb();
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", fetchMock);
    await replyToReview("org-1", "accounts/1/locations/2", "rev9", "Merci !");
    expect(fetchMock.mock.calls[0][0]).toBe("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/rev9/reply");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
  });
});

describe("syncAll", () => {
  beforeEach(() => { vi.restoreAllMocks(); mockDb(); });

  it("upserts mapped locations and reviews (pagination, star enum, v4 name)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("mybusinessaccountmanagement")) return json({ accounts: [{ name: "accounts/123" }] });
      if (url.includes("mybusinessbusinessinformation") && !url.includes("pageToken")) {
        return json({ locations: [{ name: "locations/1", title: "A", phoneNumbers: { primaryPhone: "0102" } }], nextPageToken: "n" });
      }
      if (url.includes("mybusinessbusinessinformation")) return json({ locations: [{ name: "locations/2", title: "B" }] });
      if (url.includes("/v4/accounts/123/locations/1/reviews")) {
        return json({ averageRating: 4.5, totalReviewCount: 2, reviews: [
          { reviewId: "r1", starRating: "FIVE", comment: "top", reviewer: { displayName: "Zoe" }, createTime: "2026-01-01T00:00:00Z" },
          { reviewId: "r2", starRating: "THREE", reviewReply: { comment: "merci" } },
        ] });
      }
      if (url.includes("/v4/accounts/123/locations/2/reviews")) return json({ reviews: [] });
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncAll("org-1");

    expect(result).toMatchObject({ accounts: 1, locations: 2, reviews: 2, errors: [] });
    const locWrites = writes.filter(w => /INSERT INTO google_locations/.test(w.sql));
    expect(locWrites).toHaveLength(2);
    expect(locWrites[0].params.slice(0, 9)).toEqual(["org-1_locations/1", "org-1", "1", "A", null, 4.5, 2, "0102", null]);
    expect(JSON.parse(locWrites[0].params[11] as string).v4Name).toBe("accounts/123/locations/1");
    const revWrites = writes.filter(w => /INSERT INTO google_reviews/.test(w.sql));
    expect(revWrites.map(w => w.params[5])).toEqual([5, 3]);
    expect(revWrites[0].params[2]).toBe("org-1_locations/1");
    expect(revWrites[1].params[9]).toBe("merci");
  });

  it("returns the Google error instead of an empty success when the API is blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("mybusinessaccountmanagement")) return json({ accounts: [{ name: "accounts/123" }] });
      return googleError(403, { code: 403, status: "PERMISSION_DENIED", message: "API has not been used in project", details: [{ reason: "SERVICE_DISABLED" }] });
    }));
    const result = await syncAll("org-1");
    expect(result.locations).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "API_NOT_ENABLED", status: 403, reason: "SERVICE_DISABLED" });
    expect(writes.filter(w => /INSERT INTO google_locations/.test(w.sql))).toHaveLength(0);
  });

  it("keeps the location when only the v4 reviews call is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("mybusinessaccountmanagement")) return json({ accounts: [{ name: "accounts/123" }] });
      if (url.includes("mybusinessbusinessinformation")) return json({ locations: [{ name: "locations/1", title: "A" }] });
      return googleError(429, { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" });
    }));
    const result = await syncAll("org-1");
    expect(result.locations).toBe(1);
    expect(result.errors[0]).toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(writes.filter(w => /INSERT INTO google_locations/.test(w.sql))).toHaveLength(1);
  });
});
