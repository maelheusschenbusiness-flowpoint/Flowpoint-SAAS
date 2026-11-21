import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));

import router from "./local-presence-optimizer.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: "org-a",
      orgDb: (...args: unknown[]) => (mocks.query as (...a: unknown[]) => unknown)(...args),
    });
    next();
  });
  app.use("/api", router);
  return app;
}

describe("Local Presence Optimizer — validation des reglages", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("refuse un critere inconnu au lieu de l'ecarter en silence", async () => {
    const res = await request(makeApp()).put("/api/local-presence/settings").send({ trackedFields: ["phone", "website"] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TRACKED_FIELDS");
    expect(res.body.error).toContain("website");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("refuse un trackedFields qui n'est pas une liste", async () => {
    const res = await request(makeApp()).put("/api/local-presence/settings").send({ trackedFields: "phone" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TRACKED_FIELDS");
  });

  it("refuse un identifiant de fiche qui n'est pas une chaine", async () => {
    const res = await request(makeApp()).put("/api/local-presence/settings").send({ locationId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_LOCATION_ID");
  });

  it("enregistre exactement les criteres demandes quand ils sont tous valides", async () => {
    const res = await request(makeApp()).put("/api/local-presence/settings").send({ trackedFields: ["phone"] });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ locationId: null, trackedFields: ["phone"] });
  });
});
