import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getPerformanceWithToken: vi.fn(),
  getValidToken: vi.fn(),
  addonAllowed: true,
  addonAllowedByKey: {} as Record<string, boolean>,
  addonGateCalls: [] as string[],
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: (addonKey: string) => (_req: unknown, res: any, next: () => void) => {
    mocks.addonGateCalls.push(addonKey);
    const allowed = mocks.addonAllowedByKey[addonKey] ?? mocks.addonAllowed;
    if (!allowed) {
      res.status(402).json({ error: "addon_gate_blocked", addonKey });
      return;
    }
    next();
  },
}));
vi.mock("../services/google-service.js", () => ({
  getPerformanceWithToken: mocks.getPerformanceWithToken,
  getValidToken: mocks.getValidToken,
  GooglePerformanceApiError: class GooglePerformanceApiError extends Error {
    status: number;
    constructor(status: number) {
      super("Google Business Profile Performance API returned HTTP " + status);
      this.name = "GooglePerformanceApiError";
      this.status = status;
    }
  },
}));
vi.mock("../services/ga4-service.js", () => ({
  getGA4ConversionPages: vi.fn().mockResolvedValue({ rows: [] }),
}));

import { GooglePerformanceApiError } from "../services/google-service.js";
import gbpPerformanceRouter from "./gbp-performance.js";
import conversionOpportunityEngineRouter from "./conversion-opportunity-engine.js";

function makeApp(orgId: string | null = "org-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (orgId) Object.assign(req, {
      orgContext: { orgId },
      orgDb: vi.fn().mockResolvedValue({ rows: [] }),
    });
    next();
  });
  app.use("/api", gbpPerformanceRouter);
  app.use("/api", conversionOpportunityEngineRouter);
  return app;
}

function queueGbpRead(connected: boolean, locations: unknown[] = [], settings?: unknown) {
  mocks.query
    .mockResolvedValueOnce({ rows: settings ? [{ settings }] : [] })
    .mockResolvedValueOnce({ rows: locations })
    .mockResolvedValueOnce({ rows: [{ connected }] });
}

describe("GBP Performance & Leads API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.getValidToken.mockReset().mockResolvedValue("synthetic-google-token");
    mocks.getPerformanceWithToken.mockReset().mockResolvedValue([]);
    mocks.addonAllowed = true;
    mocks.addonAllowedByKey = {};
    mocks.addonGateCalls = [];
  });

  it("requires a valid authenticated organization context", async () => {
    const response = await request(makeApp(null)).get("/api/gbp-performance");

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("scopes reads to the authenticated organization and treats an absent GBP flag as disconnected", async () => {
        queueGbpRead(false);
        const response = await request(makeApp()).get("/api/gbp-performance");
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ ok: true, configured: false, connectionRequired: true, locations: [] });
        expect(mocks.query.mock.calls.map(([sql, values]) => [String(sql), values])).toEqual([
          [expect.stringContaining("FROM gbp_performance_settings"), ["org-a"]],
          [expect.stringContaining("FROM google_locations"), ["org-a"]],
          [expect.stringContaining("FROM google_product_connections"), ["org-a"]],
        ]);
        expect(mocks.getValidToken).not.toHaveBeenCalled();
        expect(mocks.getPerformanceWithToken).not.toHaveBeenCalled();
      });

      it("retrieves and summarizes metrics only when the GBP product connection is active", async () => {
        const settings = { locationId: "loc-a", periodDays: 30, goals: { CALL_CLICKS: 40 }, alertDropPercent: 25 };
        queueGbpRead(true, [{ id: "loc-a", name: "Location A", raw_data: { name: "accounts/acct/locations/loc-a" } }], settings);
        const metric = (value: number) => [{ dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: String(value) }] } }];
        mocks.getPerformanceWithToken.mockResolvedValueOnce(metric(5)).mockResolvedValueOnce(metric(20));
        const response = await request(makeApp()).get("/api/gbp-performance");
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          ok: true,
          configured: true,
          location: { id: "loc-a", name: "Location A" },
          current: { CALL_CLICKS: 5 },
          previous: { CALL_CLICKS: 20 },
          drops: { CALL_CLICKS: 75 },
          goals: { CALL_CLICKS: 40 },
        });
        expect(mocks.getValidToken).toHaveBeenCalledTimes(1);
        expect(mocks.getValidToken).toHaveBeenCalledWith("org-a");
        expect(mocks.getPerformanceWithToken).toHaveBeenCalledTimes(2);
        expect(mocks.getPerformanceWithToken).toHaveBeenCalledWith(
          "synthetic-google-token",
          "accounts/acct/locations/loc-a",
          expect.objectContaining({ startTime: expect.any(String), endTime: expect.any(String) }),
        );
      });

      it("does not call Google when GBP is disconnected even if cached locations and a shared token exist", async () => {
        queueGbpRead(false, [{ id: "loc-a", name: "Old location", raw_data: { name: "accounts/acct/locations/loc-a" } }]);
        const response = await request(makeApp()).get("/api/gbp-performance");
        expect(response.body).toMatchObject({ configured: false, connectionRequired: true });
        expect(mocks.getValidToken).not.toHaveBeenCalled();
        expect(mocks.getPerformanceWithToken).not.toHaveBeenCalled();
      });

      it("surfaces token retrieval failures instead of reporting a disconnected account", async () => {
        queueGbpRead(true, [{ id: "loc-a", name: "Location A", raw_data: { name: "accounts/acct/locations/loc-a" } }]);
        mocks.getValidToken.mockRejectedValueOnce(new Error("database token lookup failed"));
        const response = await request(makeApp()).get("/api/gbp-performance");
        expect(response.status).toBe(502);
        expect(response.body).toMatchObject({ ok: false, code: "GBP_TOKEN_UNAVAILABLE" });
        expect(mocks.getPerformanceWithToken).not.toHaveBeenCalled();
      });

      it("maps Google permission errors to a clear authorization message", async () => {
        queueGbpRead(true, [{ id: "loc-a", name: "Location A", raw_data: { name: "accounts/acct/locations/loc-a" } }]);
        mocks.getPerformanceWithToken.mockRejectedValueOnce(new GooglePerformanceApiError(403));
        const response = await request(makeApp()).get("/api/gbp-performance");
        expect(response.status).toBe(502);
        expect(response.body).toMatchObject({ ok: false, code: "GBP_GOOGLE_PERMISSION_REQUIRED" });
        expect(response.body.error).toContain("droits du compte");
      });

  it("maps Google quota responses to retry guidance", async () => {
        queueGbpRead(true, [{ id: "loc-a", name: "Location A", raw_data: { name: "accounts/acct/locations/loc-a" } }]);
        mocks.getPerformanceWithToken.mockRejectedValueOnce(new GooglePerformanceApiError(429));

        const response = await request(makeApp()).get("/api/gbp-performance");

        expect(response.status).toBe(502);
        expect(response.body).toMatchObject({ ok: false, code: "GBP_PROVIDER_RATE_LIMITED" });
        expect(response.body.error).toContain("Réessayez plus tard");
      });

      it("persists valid settings only after confirming the location belongs to the organization", async () => {
    const settings = {
      locationId: "loc-a",
      periodDays: 30,
      goals: { CALL_CLICKS: 40 },
      alertDropPercent: 25,
    };
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "loc-a" }] })
      .mockResolvedValueOnce({ rows: [{ settings, updated_at: "2026-10-23T00:00:00Z" }] });

    const response = await request(makeApp())
      .put("/api/gbp-performance/settings")
      .send(settings);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, settings });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["loc-a", "org-a"]);
    expect(mocks.query.mock.calls[1]?.[1]).toEqual(["org-a", JSON.stringify(settings)]);
  });

  it("rejects a location owned by another organization without saving settings", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp())
      .put("/api/gbp-performance/settings")
      .send({
        locationId: "other-org-location",
        periodDays: 30,
        goals: {},
        alertDropPercent: 20,
      });

    expect(response.status).toBe(404);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("keeps the route blocked when the add-on entitlement is absent", async () => {
    mocks.addonAllowed = false;

    const response = await request(makeApp()).get("/api/gbp-performance");

    expect(response.status).toBe(402);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not apply the GBP entitlement gate to the following Conversion route", async () => {
    mocks.addonAllowedByKey = {
      gbpPerformanceLeads: false,
      conversionOpportunityEngine: true,
    };

    const response = await request(makeApp()).get("/api/conversion-opportunity-engine");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, source: "ga4", opportunities: [] });
    expect(mocks.addonGateCalls).toEqual(["conversionOpportunityEngine"]);
  });
});
