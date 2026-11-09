import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getForecastData: vi.fn(),
  generateForecasts: vi.fn(),
}));

vi.mock("../services/forecasting-service.js", () => mocks);
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/cacheControl.js", () => ({
  withCache: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import forecastRouter from "./forecast.js";

function makeApp(orgId = "org-a") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgContext: { orgId } });
    next();
  });
  app.use("/api", forecastRouter);
  return app;
}

const insufficientData = {
  siteUrl: "https://customer.example",
  forecasts: [],
  available: false,
  status: "insufficient_data",
  minimumHistoryDays: 14,
  ga4Available: false,
  source: "none",
  reason: "Au moins 14 jours de données GA4 valides sont nécessaires.",
  summary: {
    expectedTrafficIn30d: 0,
    expectedTrafficIn90d: 0,
    expectedConversionsIn30d: 0,
    expectedRevenueIn90d: 0,
    confidenceScore: 0,
    growthScenarios: { pessimistic: 0, realistic: 0, optimistic: 0 },
  },
  generatedAt: "2026-11-09T00:00:00.000Z",
};

describe("forecast API insufficient-data contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an explicit insufficient_data state from the tenant-scoped read endpoint", async () => {
    mocks.getForecastData.mockResolvedValue(insufficientData);

    const response = await request(makeApp("tenant-a"))
      .get("/api/forecast")
      .query({ siteUrl: "https://customer.example" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      available: false,
      status: "insufficient_data",
      minimumHistoryDays: 14,
      forecasts: [],
    });
    expect(mocks.getForecastData).toHaveBeenCalledWith({
      orgId: "tenant-a",
      siteUrl: "https://customer.example",
    });
  });

  it("returns 422 with the same explicit state when generation lacks history", async () => {
    mocks.generateForecasts.mockResolvedValue(insufficientData);

    const response = await request(makeApp("tenant-b"))
      .post("/api/forecast/generate")
      .send({ siteUrl: "https://customer.example" });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      ok: false,
      available: false,
      status: "insufficient_data",
      minimumHistoryDays: 14,
      forecasts: [],
      error: insufficientData.reason,
    });
    expect(mocks.generateForecasts).toHaveBeenCalledWith("tenant-b", "https://customer.example");
  });

  it("does not accept a client-supplied organization identity", async () => {
    mocks.getForecastData.mockResolvedValue(insufficientData);

    await request(makeApp("tenant-a"))
      .get("/api/forecast")
      .query({ orgId: "tenant-b" });

    expect(mocks.getForecastData).toHaveBeenCalledWith({ orgId: "tenant-a", siteUrl: undefined });
  });
});
