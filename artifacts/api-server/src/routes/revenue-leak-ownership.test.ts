import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ orgDb: vi.fn(), getGA4ConversionPages: vi.fn() }));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/ga4-service.js", () => ({
  getGA4ConversionPages: mocks.getGA4ConversionPages,
}));

import revenueLeakRouter from "./revenue-leak.js";

const SITE_URL = "https://customer.example";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: mocks.orgDb });
    next();
  });
  app.use("/api", revenueLeakRouter);
  return app;
}

describe("Revenue Leak site ownership errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGA4ConversionPages.mockResolvedValue({ rows: [], totals: [], currencyCode: null });
    mocks.orgDb.mockImplementation(async (sql: string) => {
      if (sql.includes("behavior_site_tokens")) return { rows: [{ owned: 1 }] };
      return { rows: [] };
    });
  });

  it("allows a site owned by the current organization", async () => {
    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.attribution).toMatchObject({
      status: "insufficient_data",
      reason: "no_shared_identifier",
    });
    expect(response.body.financial).toMatchObject({
      status: "unavailable",
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    });
    expect(mocks.orgDb).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND site_url = $2"),
      ["org-a", SITE_URL],
    );
  });

  it("keeps observed behavioral signals separate from GA4 aggregate revenue on GET and detect", async () => {
    mocks.orgDb.mockImplementation(async (sql: string) => {
      if (sql.includes("behavior_site_tokens")) return { rows: [{ owned: 1 }] };
      if (sql.includes("FROM behavior_events")) {
        return {
          rows: [{
            siteUrl: SITE_URL,
            page: "/checkout",
            sessionId: "fp_tracker_session",
            eventType: "form_abandon",
            scrollDepth: null,
          }],
        };
      }
      return { rows: [] };
    });

    const getResponse = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });
    const detectResponse = await request(makeApp())
      .post("/api/revenue-leak/detect")
      .send({ siteUrl: SITE_URL });

    for (const response of [getResponse, detectResponse]) {
      expect(response.status).toBe(200);
      expect(response.body.opportunities).toHaveLength(1);
      expect(response.body.opportunities[0]).toMatchObject({
        financialClassification: "unmeasured",
        observedRevenueLoss: null,
        estimatedRevenueLoss: null,
      });
      expect(response.body.attribution.status).toBe("insufficient_data");
      expect(response.body.financial.observedLoss).toBeNull();
      expect(response.body.financial.estimatedLoss).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain("fp_tracker_session");
    }
  });

  it("returns the same generic 404 for missing and non-owned sites", async () => {
    mocks.orgDb.mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Site not found" });
    expect(JSON.stringify(response.body)).not.toContain("org-b");
  });

  it("returns 503 rather than a false 404 when ownership verification fails", async () => {
    mocks.orgDb.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/could not be verified/i);
    expect(JSON.stringify(response.body)).not.toContain("database unavailable");
  });

  it("also returns 503 for technical failures on detect without exposing site existence", async () => {
    mocks.orgDb.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await request(makeApp())
      .post("/api/revenue-leak/detect")
      .send({ siteUrl: SITE_URL });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/could not be verified/i);
    expect(JSON.stringify(response.body)).not.toContain("database unavailable");
  });
});
