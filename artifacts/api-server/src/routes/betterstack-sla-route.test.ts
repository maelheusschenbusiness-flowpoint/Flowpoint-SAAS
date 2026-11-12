import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exigerAppartenance: vi.fn(),
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
  exigerAppartenance: mocks.exigerAppartenance,
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
// B-03 : les gardes de planGate verifient aussi l'etat d'abonnement. Ce test cible
// la logique d'add-on SLA : l'organisation simulee a un abonnement actif.
vi.mock("../services/billing-context.js", () => ({
  BillingContextUnavailableError: class extends Error {},
  loadBillingContext: vi.fn(async () => ({
    subscriptionStatus: "active", plan: "standard", hasPaidAccess: true, accessMode: "full", inPaidGracePeriod: false,
    trialEndsAt: null, currentPeriodEnd: null, canStartTrial: false,
  })),
}));
vi.mock("../services/init-bs-ownership.js", () => ({ registreAppartenancePresent: vi.fn() }));
vi.mock("../services/global-monitoring.js", () => ({
  summarizeGlobalMonitoring: mocks.summarizeGlobalMonitoring,
}));

import betterstackRouter from "./betterstack.js";

const QA_ORG_A = "10000000-0000-4000-8000-00000000000a";
const QA_ORG_B = "10000000-0000-4000-8000-00000000000b";

function makeApp(orgId = QA_ORG_A, orgDb?: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId, ...(orgDb ? { orgDb } : {}) });
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

  it("rejects impossible calendar dates before calling Better Stack", async () => {
    const response = await request(makeApp())
      .get("/api/betterstack/monitors/monitor-42/sla?from=2026-02-30&to=2026-03-01");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_SLA_RANGE");
    expect(mocks.getMonitorSLA).not.toHaveBeenCalled();
  });

  it("rejects reversed SLA date ranges before calling Better Stack", async () => {
    const response = await request(makeApp())
      .get("/api/betterstack/monitors/monitor-42/sla?from=2026-09-30&to=2026-09-01");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_SLA_RANGE");
    expect(mocks.getMonitorSLA).not.toHaveBeenCalled();
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

  it("returns an explicit provider failure instead of an empty SLA result", async () => {
    mocks.getMonitorSLA.mockRejectedValue(new Error("Better Stack temporarily unavailable"));

    const response = await request(makeApp()).get("/api/betterstack/monitors/monitor-42/sla");

    expect(response.status).toBe(500);
    expect(response.body.data).toBeUndefined();
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

  it("returns an explicit provider failure instead of fabricated global regions", async () => {
    mocks.listMonitors.mockRejectedValue(new Error("Better Stack temporarily unavailable"));

    const response = await request(makeApp()).get("/api/betterstack/global-overview");

    expect(response.status).toBe(500);
    expect(response.body.regions).toBeUndefined();
    expect(mocks.summarizeGlobalMonitoring).not.toHaveBeenCalled();
  });

  it("keeps the Global Monitoring endpoint behind its existing add-on gate", () => {
    const source = readFileSync(new URL("./betterstack.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /router\.get\("\/betterstack\/global-overview",\s*requireAddon\("globalMonitoring",\s*"Global Monitoring"\)/,
    );
  });
});

describe("SLA Monitoring Avancé — cibles, conformité et export", () => {
  /** Faux orgDb en memoire : une table (org_id, monitor_id) -> cible, comme la vraie contrainte. */
  function memoryDb() {
    const rows = new Map<string, number>();
    const seen: Array<{ sql: string; values: unknown[] }> = [];
    const orgDb = async (sql: string, values: unknown[] = []) => {
      seen.push({ sql, values });
      if (sql.includes("INSERT INTO sla_targets")) { rows.set(`${values[0]}|${values[1]}`, Number(values[2])); return { rows: [] }; }
      if (sql.includes("DELETE FROM sla_targets")) { rows.delete(`${values[0]}|${values[1]}`); return { rows: [] }; }
      if (sql.includes("monitor_id, target_pct FROM sla_targets")) {
        return { rows: [...rows].filter(([k]) => k.startsWith(`${values[0]}|`)).map(([k, v]) => ({ monitor_id: k.split("|")[1], target_pct: v })) };
      }
      if (sql.includes("target_pct FROM sla_targets")) {
        const v = rows.get(`${values[0]}|${values[1]}`);
        return { rows: v === undefined ? [] : [{ target_pct: v }] };
      }
      return { rows: [] };
    };
    return { orgDb, rows, seen };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBSConfigured.mockReturnValue(true);
    mocks.poolConnect.mockResolvedValue({ query: mocks.poolQuery, release: vi.fn() });
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT plan FROM organizations")) return { rows: [{ plan: "standard" }] };
      if (sql.includes("SELECT active FROM org_addons")) return { rows: [{ active: true }] };
      return { rows: [] };
    });
    mocks.exigerAppartenance.mockResolvedValue(undefined);
    mocks.getMonitorSLA.mockResolvedValue({ data: { attributes: { availability: 99.8, total_downtime: 900, number_of_incidents: 2, longest_incident: 600, average_incident: 450 } } });
  });

  it("sans cible : no_target ; avec cible : conforme ou dépassé selon la mesure Better Stack", async () => {
    const { orgDb } = memoryDb();
    const app = makeApp(QA_ORG_A, orgDb);
    let r = await request(app).get("/api/betterstack/monitors/m1/sla");
    expect(r.body.compliance).toMatchObject({ status: "no_target", targetPct: null, availabilityPct: 99.8 });
    expect((await request(app).put("/api/betterstack/monitors/m1/sla-target").send({ targetPct: 99.5 })).status).toBe(200);
    r = await request(app).get("/api/betterstack/monitors/m1/sla");
    expect(r.body.compliance).toMatchObject({ status: "met", targetPct: 99.5 });
    await request(app).put("/api/betterstack/monitors/m1/sla-target").send({ targetPct: 99.95 });
    r = await request(app).get("/api/betterstack/monitors/m1/sla");
    expect(r.body.compliance).toMatchObject({ status: "breached", targetPct: 99.95 });
    expect(r.body.data.attributes.availability).toBe(99.8); // la mesure d'origine est intacte
  });

  it("mesure absente : insufficient_data, jamais « conforme »", async () => {
    mocks.getMonitorSLA.mockResolvedValue({ data: { attributes: {} } });
    const { orgDb } = memoryDb();
    const app = makeApp(QA_ORG_A, orgDb);
    await request(app).put("/api/betterstack/monitors/m1/sla-target").send({ targetPct: 99.5 });
    const r = await request(app).get("/api/betterstack/monitors/m1/sla");
    expect(r.body.compliance.status).toBe("insufficient_data");
  });

  it("refuse une cible invalide sans rien écrire", async () => {
    const { orgDb, rows } = memoryDb();
    const app = makeApp(QA_ORG_A, orgDb);
    for (const bad of [89, 100, "abc", null, undefined, -5, "99,9"]) {
      const r = await request(app).put("/api/betterstack/monitors/m1/sla-target").send({ targetPct: bad });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("INVALID_SLA_TARGET");
    }
    expect(rows.size).toBe(0);
  });

  it("isole les organisations : même moniteur, cibles distinctes, rien ne fuit", async () => {
    const { orgDb, rows } = memoryDb();
    await request(makeApp(QA_ORG_A, orgDb)).put("/api/betterstack/monitors/shared-id/sla-target").send({ targetPct: 99.9 });
    await request(makeApp(QA_ORG_B, orgDb)).put("/api/betterstack/monitors/shared-id/sla-target").send({ targetPct: 95 });
    expect(rows.get(`${QA_ORG_A}|shared-id`)).toBe(99.9);
    expect(rows.get(`${QA_ORG_B}|shared-id`)).toBe(95);
    const a = await request(makeApp(QA_ORG_A, orgDb)).get("/api/betterstack/sla-targets");
    expect(a.body.targets).toEqual([{ monitorId: "shared-id", targetPct: 99.9 }]);
    await request(makeApp(QA_ORG_B, orgDb)).delete("/api/betterstack/monitors/shared-id/sla-target");
    expect(rows.get(`${QA_ORG_A}|shared-id`)).toBe(99.9); // la suppression de B ne touche pas A
  });

  it("refuse l'écriture d'une cible sur un moniteur d'une autre organisation", async () => {
    mocks.exigerAppartenance.mockRejectedValue(Object.assign(new Error("Monitor not found"), { statusCode: 404 }));
    const { orgDb, rows } = memoryDb();
    const r = await request(makeApp(QA_ORG_A, orgDb)).put("/api/betterstack/monitors/foreign/sla-target").send({ targetPct: 99 });
    expect(r.status).toBe(404);
    expect(rows.size).toBe(0);
    expect(mocks.exigerAppartenance).toHaveBeenCalledWith("foreign", QA_ORG_A);
  });

  it("export CSV : en-têtes de téléchargement, conformité incluse, période validée", async () => {
    const { orgDb } = memoryDb();
    const app = makeApp(QA_ORG_A, orgDb);
    await request(app).put("/api/betterstack/monitors/m1/sla-target").send({ targetPct: 99.5 });
    const r = await request(app).get("/api/betterstack/monitors/m1/sla/export.csv?from=2026-09-01&to=2026-09-30");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.text.trim().split("\r\n")[1]).toBe("m1,2026-09-01,2026-09-30,99.8,99.5,met,0.3,900,2,600,450");
    const bad = await request(app).get("/api/betterstack/monitors/m1/sla/export.csv?from=2026-02-30");
    expect(bad.status).toBe(400);
  });

  it("sans configuration Better Stack : 503, aucune mesure inventée", async () => {
    mocks.isBSConfigured.mockReturnValue(false);
    const r = await request(makeApp()).get("/api/betterstack/monitors/m1/sla/export.csv");
    expect(r.status).toBe(503);
  });
});
