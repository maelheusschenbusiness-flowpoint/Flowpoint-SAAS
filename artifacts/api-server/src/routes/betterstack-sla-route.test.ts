import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMonitorSLA: vi.fn(),
  listMonitors: vi.fn(),
  isBSConfigured: vi.fn(),
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  summarizeGlobalMonitoring: vi.fn(),
}));

vi.mock("../services/betterstack-service.js", () => ({
  listMonitors: mocks.listMonitors,
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
  pool: { query: mocks.poolQuery, connect: mocks.poolConnect },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: any, _res: any, next: any) => next(),
  canWrite: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/init-bs-ownership.js", () => ({ registreAppartenancePresent: vi.fn() }));
vi.mock("../services/global-monitoring.js", () => ({
  summarizeGlobalMonitoring: mocks.summarizeGlobalMonitoring,
}));

import betterstackRouter from "./betterstack.js";

const QA_ORG_A = "10000000-0000-4000-8000-00000000000a";
const QA_ORG_B = "10000000-0000-4000-8000-00000000000b";

function makeApp(orgId = QA_ORG_A) {
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { orgId });
    next();
  });
  app.use("/api", betterstackRouter);
  return app;
}

describe("Better Stack SLA report route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBSConfigured.mockReturnValue(true);
    mocks.poolConnect.mockResolvedValue({
      query: mocks.poolQuery,
      release: vi.fn(),
    });
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan FROM organizations")) return { rows: [{ plan: "standard" }] };
      if (sql.includes("SELECT active FROM org_addons")) return { rows: [{ active: true }] };
      return { rows: [] };
    });
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
      QA_ORG_A,
      "2026-09-01",
      "2026-09-30",
    );
  });

  it("denies SLA data when the organization has no active SLA add-on", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan FROM organizations")) return { rows: [{ plan: "standard" }] };
      return { rows: [] };
    });

    const response = await request(makeApp()).get("/api/betterstack/monitors/monitor-42/sla");

    expect(response.status).toBe(402);
    expect(response.body).toMatchObject({ code: "ADDON_REQUIRED", addonKey: "slaMonitoring" });
    expect(mocks.getMonitorSLA).not.toHaveBeenCalled();
  });

  it("does not let organization A use organization B's active SLA add-on", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT plan FROM organizations")) return { rows: [{ plan: "standard" }] };
      if (sql.includes("SELECT active FROM org_addons") && values[0] === QA_ORG_B) {
        return { rows: [{ active: true }] };
      }
      return { rows: [] };
    });

    const denied = await request(makeApp(QA_ORG_A)).get("/api/betterstack/monitors/monitor-42/sla");
    const allowed = await request(makeApp(QA_ORG_B)).get("/api/betterstack/monitors/monitor-42/sla");

    expect(denied.status).toBe(402);
    expect(denied.body).toMatchObject({ code: "ADDON_REQUIRED", addonKey: "slaMonitoring" });
    expect(allowed.status).toBe(200);
    expect(mocks.getMonitorSLA).toHaveBeenCalledTimes(1);
    expect(mocks.getMonitorSLA).toHaveBeenCalledWith("monitor-42", QA_ORG_B, undefined, undefined);
  });

  it("preserves an ownership rejection instead of exposing another organization's monitor", async () => {
    mocks.getMonitorSLA.mockRejectedValue(Object.assign(new Error("Monitor introuvable"), { statusCode: 404 }));

    const response = await request(makeApp()).get("/api/betterstack/monitors/monitor-other/sla");

    expect(response.status).toBe(404);
    expect(mocks.getMonitorSLA).toHaveBeenCalledWith("monitor-other", QA_ORG_A, undefined, undefined);
  });

  it("fails explicitly when Better Stack is not configured and makes no provider call", async () => {
    mocks.isBSConfigured.mockReturnValue(false);

    const response = await request(makeApp()).get("/api/betterstack/monitors/monitor-42/sla");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ configured: false });
    expect(mocks.getMonitorSLA).not.toHaveBeenCalled();
  });

  it("summarizes only monitors loaded for the authenticated organization", async () => {
    const monitors = [{ id: "qa-monitor-a", attributes: { name: "QA monitor" } }];
    const summary = { configuredRegionCount: 1, configuredMonitorCount: 1, regions: [] };
    mocks.listMonitors.mockResolvedValue(monitors);
    mocks.summarizeGlobalMonitoring.mockReturnValue(summary);

    const response = await request(makeApp()).get("/api/betterstack/global-overview");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(summary);
    expect(mocks.listMonitors).toHaveBeenCalledWith(QA_ORG_A);
    expect(mocks.summarizeGlobalMonitoring).toHaveBeenCalledWith(monitors);
  });

  it("denies Global Monitoring when the organization has no active add-on", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan FROM organizations")) return { rows: [{ plan: "standard" }] };
      return { rows: [] };
    });

    const response = await request(makeApp()).get("/api/betterstack/global-overview");

    expect(response.status).toBe(402);
    expect(response.body).toMatchObject({ code: "ADDON_REQUIRED", addonKey: "globalMonitoring" });
    expect(mocks.listMonitors).not.toHaveBeenCalled();
  });

  it("fails explicitly for Global Monitoring when Better Stack is not configured", async () => {
    mocks.isBSConfigured.mockReturnValue(false);

    const response = await request(makeApp()).get("/api/betterstack/global-overview");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ configured: false });
    expect(mocks.listMonitors).not.toHaveBeenCalled();
  });

  it("keeps the Global Monitoring endpoint behind its existing add-on gate", () => {
    const source = readFileSync(new URL("./betterstack.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /router\.get\("\/betterstack\/global-overview",\s*requireAddon\("globalMonitoring",\s*"Global Monitoring"\)/,
    );
  });
});
