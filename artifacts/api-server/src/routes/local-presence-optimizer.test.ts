import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbCalls, gate } = vi.hoisted(() => ({
  dbCalls: [] as Array<{ orgId: string; sql: string; values: unknown[] }>,
  gate: { keys: [] as string[] },
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: (key: string) => { gate.keys.push(key); return (_req: unknown, _res: unknown, next: () => void) => next(); },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router from "./local-presence-optimizer.js";

const PROFILE = { title: "Cafe", phoneNumbers: { primaryPhone: "+32 2 555 0101" } };

function appFor(orgId: string, ownedLocations: string[] = ["loc-a"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: async (sql: string, values: unknown[] = []) => {
        dbCalls.push({ orgId, sql, values });
        if (sql.includes("FROM google_locations WHERE org_id=$1 ORDER BY")) {
          return { rows: [{ id: "loc-a", name: "Cafe A", raw_data: PROFILE, last_sync_at: "2026-10-22T10:00:00Z" }] };
        }
        if (sql.includes("local_presence_settings") && sql.startsWith("SELECT")) return { rows: [] };
        if (sql.includes("FROM google_locations WHERE id=$1")) return { rows: ownedLocations.includes(String(values[0])) ? [{ id: values[0] }] : [] };
        return { rows: [] };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("local-presence-optimizer routes", () => {
  beforeEach(() => dbCalls.splice(0));

  it("est monte derriere requireAddon(localPresenceOptimizer)", () => {
    expect(gate.keys).toContain("localPresenceOptimizer");
  });

  it("analyse uniquement les fiches de l'organisation authentifiee", async () => {
    const response = await request(appFor("org-a")).get("/local-presence").expect(200);
    expect(response.body).toMatchObject({ ok: true, connected: true, profile: { id: "loc-a" } });
    expect(response.body.analysis.completedFields).toBeGreaterThan(0);
    expect(dbCalls).toHaveLength(2);
    expect(dbCalls.every(call => call.values[0] === "org-a" && call.sql.includes("org_id=$1"))).toBe(true);
  });

  it("refuse sans contexte d'organisation", async () => {
    const app = express();
    app.use(router);
    await request(app).get("/local-presence").expect(401);
  });

  it("enregistre les criteres sous la cle de l'organisation, apres controle de propriete de la fiche", async () => {
    const saved = await request(appFor("org-b", ["loc-b"]))
      .put("/local-presence/settings")
      .send({ locationId: "loc-b", trackedFields: ["phone", "websiteUri"] })
      .expect(200);
    expect(saved.body.settings).toEqual({ locationId: "loc-b", trackedFields: ["phone", "websiteUri"] });
    const upsert = dbCalls.find(call => call.sql.includes("ON CONFLICT (org_id)"));
    expect(upsert?.values[0]).toBe("org-b");
  });

  it("refuse une fiche d'une autre organisation sans rien enregistrer", async () => {
    await request(appFor("org-c", []))
      .put("/local-presence/settings")
      .send({ locationId: "loc-other", trackedFields: ["phone"] })
      .expect(404);
    expect(dbCalls.some(call => call.sql.includes("INSERT"))).toBe(false);
  });

  it("refuse une selection de criteres vide", async () => {
    await request(appFor("org-d"))
      .put("/local-presence/settings")
      .send({ trackedFields: [] })
      .expect(400);
    expect(dbCalls).toHaveLength(0);
  });
});
