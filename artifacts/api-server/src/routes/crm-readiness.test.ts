import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock, getCrmStatusMock, syncCrmMock, serviceStubs } = vi.hoisted(() => ({
  orgDbMock: vi.fn(),
  getCrmStatusMock: vi.fn(),
  syncCrmMock: vi.fn(),
  serviceStubs: {
    disconnectCrm: vi.fn(),
    getSyncLogs: vi.fn(),
    getFieldMappings: vi.fn(),
    upsertFieldMapping: vi.fn(),
    getCrmLimit: vi.fn(() => 1),
  },
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/crm-service.js", () => ({
  CRM_PROVIDERS: [{ id: "hubspot", name: "HubSpot", color: "#ff7a59", icon: "crm", scopes: [] }],
  getCrmStatus: getCrmStatusMock,
  syncCrm: syncCrmMock,
  ...serviceStubs,
}));

import crmRouter from "./crm.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: orgDbMock, me: { plan: "Pro" } });
    next();
  });
  app.use("/api", crmRouter);
  return app;
}

describe("CRM routes before provider integration is implemented", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not accept or persist a raw token as a connected provider", async () => {
    const response = await request(makeApp())
      .post("/api/crm/connect/hubspot")
      .send({ accessToken: "dummy-test-token" });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ ok: false, code: "CRM_OAUTH_UNAVAILABLE" });
    expect(JSON.stringify(response.body)).not.toContain("dummy-test-token");
  });

  it("does not report a fabricated connection-test success", async () => {
    const response = await request(makeApp())
      .post("/api/crm/test")
      .send({ provider: "hubspot" });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ ok: false, code: "CRM_TEST_UNAVAILABLE" });
    expect(response.body).not.toHaveProperty("latency_ms");
  });

  it("does not report a successful zero-record synchronization", async () => {
    const unavailable = Object.assign(new Error("Not implemented"), { code: "CRM_SYNC_UNAVAILABLE" });
    syncCrmMock.mockRejectedValue(unavailable);

    const response = await request(makeApp())
      .post("/api/crm/sync")
      .send({ provider: "hubspot" });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ ok: false, code: "CRM_SYNC_UNAVAILABLE" });
  });

  it("reports CRM status database errors instead of an empty connected state", async () => {
    getCrmStatusMock.mockRejectedValue(new Error("database unavailable"));

    const response = await request(makeApp()).get("/api/crm/status");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "CRM_STATUS_UNAVAILABLE" });
  });

  it("reports log database errors instead of an empty history", async () => {
    serviceStubs.getSyncLogs.mockRejectedValue(new Error("database unavailable"));

    const response = await request(makeApp()).get("/api/crm/logs");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "CRM_LOGS_UNAVAILABLE" });
  });

  it("reports lead database errors instead of an empty lead list", async () => {
    orgDbMock.mockRejectedValue(new Error("database unavailable"));

    const response = await request(makeApp()).get("/api/crm/leads");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "CRM_LEADS_UNAVAILABLE" });
  });

  it("does not accept unsigned provider webhooks as successful", async () => {
    const response = await request(makeApp())
      .post("/api/crm/webhook/hubspot")
      .send({ eventType: "contact.created" });

    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ ok: false, code: "CRM_WEBHOOK_UNAVAILABLE" });
    expect(orgDbMock).not.toHaveBeenCalled();
  });
});
