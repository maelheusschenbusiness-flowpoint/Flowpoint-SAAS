import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gateCalls: [] as string[],
  allowed: false,
  create: vi.fn(async () => ({ id: "intg_test" })),
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: (key: string) => (_req: unknown, res: any, next: () => void) => {
    mocks.gateCalls.push(key);
    if (!mocks.allowed) { res.status(402).json({ error: "addon_required", addonKey: key }); return; }
    next();
  },
}));
vi.mock("../services/integrations-service.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIntegration: mocks.create,
}));
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import router from "./integrations.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgContext: { orgId: "org-a", plan: "pro" }, orgDb: vi.fn().mockResolvedValue({ rows: [] }) });
    next();
  });
  app.use("/api", router);
  return app;
}

describe("POST /integrations/connections : plateformes Zapier/Make", () => {
  beforeEach(() => { mocks.gateCalls = []; mocks.allowed = false; mocks.create.mockClear(); });

  for (const platform of ["zapier", "make", "Zapier", " MAKE "]) {
    it(`refuse ${JSON.stringify(platform)} sans l'add-on (402) et ne cree rien`, async () => {
      const res = await request(makeApp()).post("/api/integrations/connections").send({ name: "x", platform, endpointUrl: "https://example.com/h" });
      expect(res.status).toBe(402);
      expect(mocks.gateCalls).toEqual(["zapierIntegration"]);
      expect(mocks.create).not.toHaveBeenCalled();
    });
  }

  it("laisse passer les autres plateformes (comportement inchange)", async () => {
    const res = await request(makeApp()).post("/api/integrations/connections").send({ name: "x", platform: "slack", endpointUrl: "https://example.com/h" });
    expect(res.status).toBe(201);
    expect(mocks.gateCalls).toEqual([]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("accepte zapier avec l'add-on actif", async () => {
    mocks.allowed = true;
    const res = await request(makeApp()).post("/api/integrations/connections").send({ name: "x", platform: "zapier", endpointUrl: "https://example.com/h" });
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
