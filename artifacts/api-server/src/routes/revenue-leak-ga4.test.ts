import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgDb: vi.fn(),
  getGA4ConversionPages: vi.fn(),
}));

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

describe("Revenue Leak GA4 revenue evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgDb.mockImplementation(async (sql: string) => {
      if (sql.includes("behavior_site_tokens")) return { rows: [{ owned: 1 }] };
      if (sql.includes("ga4_properties")) return { rows: [{ websiteUrl: SITE_URL }] };
      if (sql.includes("FROM behavior_events")) {
        return { rows: [{
          siteUrl: SITE_URL,
          page: "/checkout",
          sessionId: "fp_tracker_session",
          eventType: "form_abandon",
          scrollDepth: null,
        }] };
      }
      return { rows: [] };
    });
    mocks.getGA4ConversionPages.mockResolvedValue({
      rows: [],
      totals: [{ metricValues: [{ value: "100" }, { value: "80" }, { value: "4" }, { value: "1234.56" }] }],
      currencyCode: "EUR",
    });
  });

  it("returns recognized GA4 total revenue only as observed property context", async () => {
    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(200);
    expect(mocks.getGA4ConversionPages).toHaveBeenCalledWith("org-a", "30daysAgo", "yesterday");
    expect(response.body.financial).toMatchObject({
      status: "observed",
      source: "ga4",
      observedRevenue: 1234.56,
      observedConversions: 4,
      currency: "EUR",
      observedLoss: null,
      estimatedLoss: null,
    });
    expect(response.body.attribution).toMatchObject({ status: "insufficient_data" });
    expect(response.body.opportunities[0]).toMatchObject({
      financialClassification: "unmeasured",
      observedRevenueLoss: null,
      estimatedRevenueLoss: null,
    });
    expect(response.body.financial.note).toContain("n’est pas attribué");
  });

  it("keeps observed revenue contextual and preserves null losses after explicit detection", async () => {
    const response = await request(makeApp())
      .post("/api/revenue-leak/detect")
      .send({ siteUrl: SITE_URL });

    expect(response.status).toBe(200);
    expect(response.body.financial).toMatchObject({
      status: "observed",
      observedRevenue: 1234.56,
      currency: "EUR",
      observedLoss: null,
      estimatedLoss: null,
    });
    expect(response.body.attribution.status).toBe("insufficient_data");
  });

  it("does not expose a property aggregate to a site on a different host", async () => {
    mocks.orgDb.mockImplementation(async (sql: string) => {
      if (sql.includes("behavior_site_tokens")) return { rows: [{ owned: 1 }] };
      if (sql.includes("ga4_properties")) return { rows: [{ websiteUrl: "https://other.example" }] };
      if (sql.includes("FROM behavior_events")) return { rows: [] };
      return { rows: [] };
    });

    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(200);
    expect(mocks.getGA4ConversionPages).not.toHaveBeenCalled();
    expect(response.body.financial).toMatchObject({
      status: "unavailable",
      observedRevenue: null,
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    });
  });

  it("fails closed when GA4 does not provide a recognized currency", async () => {
    mocks.getGA4ConversionPages.mockResolvedValue({
      rows: [],
      totals: [{ metricValues: [{ value: "100" }, { value: "80" }, { value: "4" }, { value: "1234.56" }] }],
      currencyCode: null,
    });

    const response = await request(makeApp()).get("/api/revenue-leak");

    expect(response.status).toBe(200);
    expect(response.body.financial).toMatchObject({
      status: "unavailable",
      observedRevenue: null,
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    });
  });

  it("rejects a three-letter value that is not an ISO 4217 currency", async () => {
    mocks.getGA4ConversionPages.mockResolvedValue({
      rows: [],
      totals: [{ metricValues: [{ value: "100" }, { value: "80" }, { value: "4" }, { value: "1234.56" }] }],
      currencyCode: "AAA",
    });

    const response = await request(makeApp()).get("/api/revenue-leak");

    expect(response.status).toBe(200);
    expect(response.body.financial).toMatchObject({
      status: "unavailable",
      observedRevenue: null,
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    });
  });

  it("does not treat a missing GA4 total as zero observed revenue", async () => {
    mocks.getGA4ConversionPages.mockResolvedValue({
      rows: [],
      totals: [{ metricValues: [{ value: "100" }, { value: "80" }, { value: "4" }, { value: "" }] }],
      currencyCode: "EUR",
    });

    const response = await request(makeApp()).get("/api/revenue-leak");

    expect(response.status).toBe(200);
    expect(response.body.financial).toMatchObject({
      status: "unavailable",
      observedRevenue: null,
      observedLoss: null,
      estimatedLoss: null,
      currency: null,
    });
  });
});
