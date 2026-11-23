import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  isConfigured: vi.fn(),
  startScan: vi.fn(),
  getDetail: vi.fn(),
  createHeatmap: vi.fn(),
  defaultBusiness: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: (...a: unknown[]) => mocks.poolQuery(...a), connect: vi.fn() },
  getDBMode: vi.fn(() => "postgres"),
  getOrgDb: vi.fn(() => vi.fn()),
  queryWithRetry: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  requireQuota: () => (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../services/dataforseo-service.js", () => ({
  isDataForSEOConfigured: (...a: unknown[]) => mocks.isConfigured(...a),
  checkAndIncrementQuota: vi.fn(async () => true),
  getGoogleMapsResults: vi.fn(),
}));
vi.mock("../services/local-maps-service.js", () => ({
  createHeatmap: (...a: unknown[]) => mocks.createHeatmap(...a),
  getHeatmaps: vi.fn(),
  getHeatmapDetail: (...a: unknown[]) => mocks.getDetail(...a),
  getMapsDashboard: vi.fn(),
  generateAiLocalRecommendations: vi.fn(async () => ({
    status: "ok", message: null,
    recommendations: [{ title: "T", description: "D", impact: "x", effort: "y", priority: "low" }],
  })),
  startHeatmapScan: (...a: unknown[]) => mocks.startScan(...a),
  resolveDefaultBusinessName: (...a: unknown[]) => mocks.defaultBusiness(...a),
}));

import router from "./local-maps.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as unknown as { orgId: string }).orgId = "org1"; next(); });
app.use(router);

const body = { name: "Zone", keyword: "plombier", businessName: "Dupont", centerLat: 50.8, centerLng: 4.3, radiusKm: 5, gridSize: 5 };

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.defaultBusiness.mockResolvedValue(null);
});

describe("POST /local-maps/heatmaps/:id/scan", () => {
  it("404 when the heatmap does not exist", async () => {
    mocks.getDetail.mockResolvedValue(null);
    expect((await request(app).post("/local-maps/heatmaps/x/scan")).status).toBe(404);
  });
  it("503 PROVIDER_NOT_CONFIGURED without DataForSEO config, never starts a scan", async () => {
    mocks.getDetail.mockResolvedValue({ id: "x" });
    mocks.isConfigured.mockResolvedValue(false);
    const res = await request(app).post("/local-maps/heatmaps/x/scan");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(mocks.startScan).not.toHaveBeenCalled();
  });
  it("409 when the claim fails, 202 when it succeeds", async () => {
    mocks.getDetail.mockResolvedValue({ id: "x" });
    mocks.isConfigured.mockResolvedValue(true);
    mocks.startScan.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect((await request(app).post("/local-maps/heatmaps/x/scan")).status).toBe(409);
    expect((await request(app).post("/local-maps/heatmaps/x/scan")).status).toBe(202);
  });
});

describe("POST /local-maps/heatmaps", () => {
  it("400 when no business name can be resolved", async () => {
    const res = await request(app).post("/local-maps/heatmaps").send({ ...body, businessName: "" });
    expect(res.status).toBe(400);
    expect(mocks.createHeatmap).not.toHaveBeenCalled();
  });
  it("503 without provider config and writes nothing", async () => {
    mocks.isConfigured.mockResolvedValue(false);
    const res = await request(app).post("/local-maps/heatmaps").send(body);
    expect(res.status).toBe(503);
    expect(mocks.createHeatmap).not.toHaveBeenCalled();
  });
  it("creates then starts the scan (202) when configured; falls back to the GBP name", async () => {
    mocks.isConfigured.mockResolvedValue(true);
    mocks.defaultBusiness.mockResolvedValue("Fiche GBP");
    mocks.createHeatmap.mockResolvedValue({ id: "hm_1" });
    mocks.startScan.mockResolvedValue(true);
    const res = await request(app).post("/local-maps/heatmaps").send({ ...body, businessName: undefined });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ok: true, scanStarted: true, status: "running" });
    expect(mocks.createHeatmap.mock.calls[0]![1]).toMatchObject({ businessName: "Fiche GBP" });
  });
});

describe("POST /local-maps/ai-recommendations", () => {
  it("returns a readable summary string and the structured list", async () => {
    const res = await request(app).post("/local-maps/ai-recommendations").send({});
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("T — D");
    expect(res.body.recommendations).toHaveLength(1);
  });
});
