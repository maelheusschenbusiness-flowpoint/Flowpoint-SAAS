import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getPerformance: vi.fn(),
  getValidToken: vi.fn(),
  addonAllowed: true,
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, res: any, next: () => void) => {
    if (!mocks.addonAllowed) {
      res.status(402).json({ error: "addon_gate_blocked" });
      return;
    }
    next();
  },
}));
vi.mock("../services/google-service.js", () => ({
  getPerformance: mocks.getPerformance,
  getValidToken: mocks.getValidToken,
}));

import gbpPerformanceRouter from "./gbp-performance.js";

function makeApp(orgId: string | null = "org-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (orgId) Object.assign(req, { orgContext: { orgId } });
    next();
  });
  app.use("/api", gbpPerformanceRouter);
  return app;
}

describe("GBP Performance & Leads API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addonAllowed = true;
  });

  it("requires a valid authenticated organization context", async () => {
    const response = await request(makeApp(null)).get("/api/gbp-performance");

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("scopes reads to the authenticated organization and reports missing Google setup", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp()).get("/api/gbp-performance");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, configured: false, locations: [] });
    expect(mocks.query.mock.calls.map(([sql, values]) => [String(sql), values])).toEqual([
      [expect.stringContaining("FROM gbp_performance_settings"), ["org-a"]],
      [expect.stringContaining("FROM google_locations"), ["org-a"]],
    ]);
    expect(mocks.getPerformance).not.toHaveBeenCalled();
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
});
