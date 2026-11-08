/**
 * D-07 — pas de faux succes a l'activation : declencheurs / actions non disponibles refuses,
 * capacite exposee, connexions limitees aux evenements reellement emis.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock, createIntegrationMock, executeWorkflowMock } = vi.hoisted(() => ({
  orgDbMock: vi.fn(),
  createIntegrationMock: vi.fn(),
  executeWorkflowMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() }, withOrgDb: vi.fn() }));
vi.mock("../services/automation-service.js", () => ({ getWorkflowsData: vi.fn(), executeWorkflow: executeWorkflowMock }));
vi.mock("../services/store.js", () => ({ store: { logActivity: vi.fn().mockResolvedValue(undefined), broadcast: vi.fn() } }));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_q: any, _s: any, n: any) => n(),
  // requireQuota("automations") ajoute par #385 sur POST /automation/workflows ; ce test ne verifie pas le plafond.
  requireQuota: () => (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../middlewares/requireAdmin.js", () => ({ requireAdmin: (_q: any, _s: any, n: any) => n() }));
vi.mock("../services/addon-entitlement.js", () => ({ hasAddonEntitlementForOrg: vi.fn().mockResolvedValue(true) }));
vi.mock("../services/integrations-service.js", () => ({
  createIntegration: createIntegrationMock,
  dispatchEvent: vi.fn(), testIntegration: vi.fn(), getIntegrationStats: vi.fn(),
  processIncomingWebhook: vi.fn(), getIntegrationLimit: () => 10,
  SUPPORTED_EVENTS: ["audit.completed", "monitor.down"],
}));
vi.mock("../services/webhook-url-safety.js", () => ({
  validatePublicHttpsWebhook: vi.fn(async (u: string) => ({ ok: true, url: u })),
}));
vi.mock("../services/integration-response.js", () => ({ presentIntegration: (i: unknown) => i }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import automationRouter from "./automation.js";
import integrationsRouter from "./integrations.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: orgDbMock, me: { plan: "Pro" }, orgContext: { userId: "u1" } });
    next();
  });
  app.use(automationRouter);
  app.use(integrationsRouter);
  return app;
}

describe("POST /automation/workflows", () => {
  beforeEach(() => { vi.clearAllMocks(); orgDbMock.mockResolvedValue({ rows: [] }); });

  it("refuse un declencheur dont l'evenement n'est pas emis (400 TRIGGER_NOT_SUPPORTED)", async () => {
    const res = await request(makeApp()).post("/automation/workflows")
      .send({ name: "W", trigger_type: "event", trigger_config: { event: "client.created" }, actions: [{ type: "run_audit" }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRIGGER_NOT_SUPPORTED");
    expect(orgDbMock).not.toHaveBeenCalled();
  });

  it("refuse un type de declencheur inexistant (condition)", async () => {
    const res = await request(makeApp()).post("/automation/workflows")
      .send({ name: "W", trigger_type: "condition", trigger_config: {}, actions: [{ type: "send_alert" }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRIGGER_NOT_SUPPORTED");
  });

  it("refuse les actions non executables (slack_notif, webhook, create_mission, gen_report)", async () => {
    for (const type of ["slack_notif", "webhook", "create_mission", "gen_report"]) {
      const res = await request(makeApp()).post("/automation/workflows")
        .send({ name: "W", trigger_type: "event", trigger_config: { event: "monitor.down" }, actions: [{ type }] });
      expect(res.status, type).toBe(400);
      expect(res.body.code).toBe("ACTION_NOT_SUPPORTED");
    }
    expect(orgDbMock).not.toHaveBeenCalled();
  });

  it("refuse un workflow planifie sans cron", async () => {
    const res = await request(makeApp()).post("/automation/workflows")
      .send({ name: "W", trigger_type: "schedule", trigger_config: { event: "weekly" }, actions: [{ type: "generate_report" }] });
    expect(res.status).toBe(400);
  });

  it("accepte un declencheur emis + actions executables et normalise l'evenement", async () => {
    const res = await request(makeApp()).post("/automation/workflows")
      .send({ name: "W", trigger_type: "event", trigger_config: { event: "monitor_down" }, actions: [{ type: "send_alert" }] });
    expect(res.status).toBe(201);
    const insert = orgDbMock.mock.calls.find(c => /INSERT INTO automation_workflows/.test(c[0]))!;
    expect(JSON.parse(insert[1][6]).event).toBe("monitor.down");
  });
});

describe("PATCH /automation/workflows/:id — activation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("409 WORKFLOW_NOT_SUPPORTED pour un workflow non supporte (aucun faux « actif »)", async () => {
    orgDbMock.mockResolvedValueOnce({ rows: [{ id: "wf_2", trigger_type: "condition", trigger_config: { metric: "uptime" }, actions: [{ type: "send_alert" }, { type: "create_incident" }] }] });
    const res = await request(makeApp()).patch("/automation/workflows/wf_2").send({ enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("WORKFLOW_NOT_SUPPORTED");
    expect(orgDbMock).toHaveBeenCalledTimes(1); // aucune ecriture
  });

  it("autorise la desactivation d'un workflow non supporte", async () => {
    orgDbMock.mockResolvedValueOnce({ rows: [{ id: "wf_2", trigger_type: "condition", trigger_config: {}, actions: [] }] });
    orgDbMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).patch("/automation/workflows/wf_2").send({ enabled: false });
    expect(res.status).toBe(200);
  });

  it("autorise l'activation d'un workflow supporte", async () => {
    orgDbMock.mockResolvedValueOnce({ rows: [{ id: "wf_1", trigger_type: "schedule", trigger_config: { cron: "0 9 * * 1" }, actions: [{ type: "generate_report" }] }] });
    orgDbMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).patch("/automation/workflows/wf_1").send({ enabled: true });
    expect(res.status).toBe(200);
  });
});

describe("GET /automation/workflows", () => {
  it("expose la capacite reelle de chaque workflow", async () => {
    orgDbMock.mockReset();
    orgDbMock
      .mockResolvedValueOnce({ rows: [
        { id: "wf_ok", trigger_type: "event", trigger_config: { event: "audit.completed" }, actions: [{ type: "run_audit" }], enabled: true },
        { id: "wf_ko", trigger_type: "condition", trigger_config: {}, actions: [{ type: "send_alert" }], enabled: true },
      ] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get("/automation/workflows");
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.workflows.map((w: any) => [w.id, w.capability.supported]));
    expect(byId).toEqual({ wf_ok: true, wf_ko: false });
  });
});

describe("POST /integrations/connections — evenements reellement emis", () => {
  beforeEach(() => { vi.clearAllMocks(); createIntegrationMock.mockResolvedValue({ id: "intg_1" }); });
  const body = (events: unknown) => ({ name: "Slack", platform: "slack", endpointUrl: "https://hooks.slack.test/x", events });

  it("400 UNSUPPORTED_EVENT pour un evenement jamais emis (aucune integration creee)", async () => {
    const res = await request(makeApp()).post("/integrations/connections").send(body(["review.received", "monitor.down"]));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_EVENT");
    expect(res.body.unsupported).toEqual(["review.received"]);
    expect(createIntegrationMock).not.toHaveBeenCalled();
  });

  it("201 pour un evenement emis, avec le synonyme monitor.recovered normalise en monitor.up", async () => {
    const res = await request(makeApp()).post("/integrations/connections").send(body(["monitor.recovered", "monitor.up"]));
    expect(res.status).toBe(201);
    expect(createIntegrationMock.mock.calls[0][2].events).toEqual(["monitor.up"]);
  });
});
