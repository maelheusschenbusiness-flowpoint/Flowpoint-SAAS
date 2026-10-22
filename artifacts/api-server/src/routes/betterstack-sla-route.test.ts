import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMonitorSLA: vi.fn(),
  isBSConfigured: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock("../services/betterstack-service.js", () => ({
  listMonitors: vi.fn(),
  getMonitor: vi.fn(),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  pauseMonitor: vi.fn(),
  resumeMonitor: vi.fn(),
  getMonitorSLA: mocks.getMonitorSLA,
  getResponseTimes: vi.fn(),
  listIncidents: vi.fn(),
  getIncident: vi.fn(),
  acknowledgeIncident: vi.fn(),
  listHeartbeats: vi.fn(),
  createHeartbeat: vi.fn(),
  listStatusPages: vi.fn(),
  createStatusPage: vi.fn(),
  getMonitoringStats: vi.fn(),
  isBSConfigured: mocks.isBSConfigured,
}));
vi.mock("@workspace/db", () => ({
  pool: { query: mocks.poolQuery, connect: vi.fn() },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: any, _res: any, next: any) => next(),
  canWrite: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/init-bs-ownership.js", () => ({ registreAppartenancePresent: vi.fn() }));
vi.mock("../services/global-monitoring.js", () => ({ summarizeGlobalMonitoring: vi.fn() }));

import betterstackRouter from "./betterstack.js";

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "qa-org-a" });
    next();
  });
  app.use("/api", betterstackRouter);
  return app;
}

describe("Better Stack SLA report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBSConfigured.mockReturnValue(true);
    mocks.getMonitorSLA.mockResolvedValue({
      data: {
        id: "monitor-42",
        type: "monitor_sla",
        attributes: {
          availability: 99.98,
          total_downtime: 600,
          number_of_incidents: 3,
          longest_incident: 300,
          average_incident: 200,
        },
      },
    });
  });

  it("returns measured SLA data for the requested monitor, period, and organization", async () => {
    const response = await request(makeApp())
      .get("/api/betterstack/monitors/monitor-42/sla?from=2026-09-01&to=2026-09-30");

    expect(response.status).toBe(200);
    expect(response.body.data.attributes).toEqual({
      availability: 99.98,
      total_downtime: 600,
      number_of_incidents: 3,
      longest_incident: 300,
      average_incident: 200,
    });
    expect(mocks.getMonitorSLA).toHaveBeenCalledWith(
      "monitor-42",
      "qa-org-a",
      "2026-09-01",
      "2026-09-30",
    );
  });

  it("preserves an ownership rejection instead of exposing another organization's monitor", async () => {
    mocks.getMonitorSLA.mockRejectedValue(Object.assign(new Error("Monitor introuvable"), { statusCode: 404 }));

    const response = await request(makeApp()).get("/api/betterstack/monitors/monitor-other/sla");

    expect(response.status).toBe(404);
    expect(mocks.getMonitorSLA).toHaveBeenCalledWith("monitor-other", "qa-org-a", undefined, undefined);
  });

  it("fails explicitly when Better Stack is not configured and makes no provider call", async () => {
    mocks.isBSConfigured.mockReturnValue(false);

    const response = await request(makeApp()).get("/api/betterstack/monitors/monitor-42/sla");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ configured: false });
    expect(mocks.getMonitorSLA).not.toHaveBeenCalled();
  });
});
