/**
 * Constat 4 : `req.me?.plan ?? "Pro"` dans crm.ts, integrations.ts, permissions.ts. Aucun middleware ne
 * renseigne req.me : TOUTE organisation (Standard comprise) etait traitee comme Pro. Le plan est
 * maintenant lu en base (resolvePlanFromDB), comme pour keywords.ts.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { planMock, createIntegrationMock, createRoleMock } = vi.hoisted(() => ({
  planMock: vi.fn(), createIntegrationMock: vi.fn(), createRoleMock: vi.fn(),
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  resolvePlanFromDB: planMock,
}));
vi.mock("../middlewares/requireAdmin.js", () => ({ requireAdmin: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/crm-service.js", async (orig) => ({
  ...(await orig<typeof import("../services/crm-service.js")>()),
  getCrmStatus: vi.fn(async () => ({ integrations: [], connected: 0, stats: {} })),
}));
vi.mock("../services/integrations-service.js", async (orig) => ({
  ...(await orig<typeof import("../services/integrations-service.js")>()),
  getIntegrationStats: vi.fn(async () => ({ total: 0 })),
  createIntegration: createIntegrationMock,
}));
vi.mock("../services/webhook-url-safety.js", () => ({
  validatePublicHttpsWebhook: vi.fn(async (u: string) => ({ ok: true, url: u })),
  postWebhookPinned: vi.fn(),
}));
vi.mock("../services/permissions-service.js", () => ({
  getRoles: vi.fn(async () => []), createRole: createRoleMock, updateRole: vi.fn(), deleteRole: vi.fn(),
  assignRole: vi.fn(), getPermissionLogs: vi.fn(async () => []), getAccessAudits: vi.fn(async () => []),
  logAccess: vi.fn(async () => undefined), getPermissionsStats: vi.fn(async () => ({})),
}));

import crmRouter from "./crm.js";
import integrationsRouter from "./integrations.js";
import permissionsRouter from "./permissions.js";
import { getCrmLimit } from "../services/crm-service.js";
import { getIntegrationLimit } from "../services/integrations-service.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { Object.assign(req, { orgId: "org-std", orgDb: vi.fn(async () => ({ rows: [] })) }); next(); });
  a.use("/api", crmRouter);
  a.use("/api", integrationsRouter);
  a.use("/api", permissionsRouter);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  planMock.mockResolvedValue("standard");
  createIntegrationMock.mockResolvedValue({ id: "i1", name: "n", platform: "zapier", events: [], headers: {}, metadata: {} });
  createRoleMock.mockResolvedValue({ id: "r1" });
});

describe("plan lu en base — une organisation Standard ne recoit PAS les droits Pro", () => {
  it("les plafonds Standard et Pro different (le test discrimine)", () => {
    expect(getIntegrationLimit("standard")).toBeLessThan(getIntegrationLimit("pro"));
    expect(getCrmLimit("standard")).toBeLessThanOrEqual(getCrmLimit("pro"));
  });

  it("GET /crm/status : plan et plafond de l'organisation (standard), pas Pro", async () => {
    const res = await request(app()).get("/api/crm/status");
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("standard");
    expect(res.body.limit).toBe(getCrmLimit("standard"));
    expect(planMock).toHaveBeenCalled();
  });

  it("GET /integrations/stats : plan standard et plafond Standard", async () => {
    const res = await request(app()).get("/api/integrations/stats");
    expect(res.body.plan).toBe("standard");
    expect(res.body.limit).toBe(getIntegrationLimit("standard"));
    expect(res.body.limit).not.toBe(getIntegrationLimit("pro"));
  });

  it("POST /integrations/connections : createIntegration recoit le plan Standard (plafond applique)", async () => {
    const res = await request(app()).post("/api/integrations/connections")
      .send({ name: "x", platform: "slack", endpointUrl: "https://hooks.example.com/x", events: [] });
    expect(res.status).toBe(201);
    expect(createIntegrationMock.mock.calls[0]![1]).toBe("standard");
  });

  it("POST /integrations/zapier/connect et /make/connect : plan lu en base", async () => {
    for (const p of ["zapier", "make"]) {
      await request(app()).post(`/api/integrations/${p}/connect`).send({ webhookUrl: "https://hooks.example.com/x", events: [] });
    }
    expect(createIntegrationMock.mock.calls.map(c => c[1])).toEqual(["standard", "standard"]);
  });

  it("POST /roles/create et GET /permissions : plan lu en base", async () => {
    await request(app()).post("/api/roles/create").send({ name: "Role" });
    expect(createRoleMock.mock.calls[0]![1]).toBe("standard");
    const res = await request(app()).get("/api/permissions");
    expect(res.body.plan).toBe("standard");
  });

  it("plan Pro en base => droits Pro (la valeur vient bien de la base)", async () => {
    planMock.mockResolvedValue("pro");
    const res = await request(app()).get("/api/integrations/stats");
    expect(res.body.plan).toBe("pro");
    expect(res.body.limit).toBe(getIntegrationLimit("pro"));
  });

  it("plan illisible (null) => standard, jamais Pro", async () => {
    planMock.mockResolvedValue(null);
    const res = await request(app()).get("/api/integrations/stats");
    expect(res.body.plan).toBe("standard");
  });
});

describe("garde de non-regression : plus de `?? \"Pro\"` dans ces routes", () => {
  it("aucune des trois routes ne retombe sur Pro", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of ["crm.ts", "integrations.ts", "permissions.ts"]) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src, f).not.toMatch(/\?\?\s*"Pro"/);
      expect(src, f).not.toMatch(/req as unknown as \{ me\?/);
    }
  });
});
