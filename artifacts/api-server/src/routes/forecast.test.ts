import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getForecastDataMock, generateForecastsMock } = vi.hoisted(() => ({
  getForecastDataMock: vi.fn(),
  generateForecastsMock: vi.fn(),
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/cacheControl.js", () => ({
  withCache: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/forecasting-service.js", () => ({
  getForecastData: getForecastDataMock,
  generateForecasts: generateForecastsMock,
}));

import forecastRouter from "./forecast.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as unknown as { orgContext: unknown }).orgContext = { orgId: "org-1" }; next(); });
app.use("/api", forecastRouter);

const GSC_ONLY = {
  siteUrl: "https://example.com/",
  forecasts: [{ date: "2026-06-16", predictedTraffic: 100, predictedConversions: null, predictedRevenue: null, confidence: 70, scenario: "realistic" }],
  available: true,
  conversionsAvailable: false,
  revenueAvailable: false,
  source: "stored",
  summary: { expectedTrafficIn30d: 100, expectedTrafficIn90d: 100, expectedConversionsIn30d: null, expectedRevenueIn90d: null, confidenceScore: 70, growthScenarios: { pessimistic: 0, realistic: 0, optimistic: 0 } },
  generatedAt: "2026-06-15T12:00:00.000Z",
};

describe("forecast routes — conversions/revenue without GA4", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /forecast exposes null (not 0) and the availability flags", async () => {
    getForecastDataMock.mockResolvedValue(GSC_ONLY);
    const res = await request(app).get("/api/forecast");
    expect(res.status).toBe(200);
    expect(res.body.conversionsAvailable).toBe(false);
    expect(res.body.revenueAvailable).toBe(false);
    expect(res.body.summary.expectedConversionsIn30d).toBeNull();
    expect(res.body.summary.expectedRevenueIn90d).toBeNull();
    expect(res.body.forecasts[0].predictedConversions).toBeNull();
    expect(res.body.forecasts[0].predictedRevenue).toBeNull();
  });

  it("POST /forecast/generate exposes null (not 0) and the availability flags", async () => {
    generateForecastsMock.mockResolvedValue({ ...GSC_ONLY, source: "gsc" });
    const res = await request(app).post("/api/forecast/generate").send({ siteUrl: "https://example.com/" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, conversionsAvailable: false, revenueAvailable: false });
    expect(res.body.summary.expectedConversionsIn30d).toBeNull();
    expect(res.body.summary.expectedRevenueIn90d).toBeNull();
  });
});
