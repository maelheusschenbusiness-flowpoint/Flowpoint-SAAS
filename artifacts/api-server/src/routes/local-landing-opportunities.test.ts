import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbCalls } = vi.hoisted(() => ({ dbCalls: [] as Array<{ orgId: string; sql: string; values: unknown[] }> }));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router from "./local-landing-opportunities.js";

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: async (sql: string, values: unknown[] = []) => {
        dbCalls.push({ orgId, sql, values });
        if (sql.includes("local_landing_opportunity_settings")) {
          return { rows: [{ settings: { services: ["plombier"], locations: ["Bruxelles"], minimumImpressions: 10, maximumPosition: 30 } }] };
        }
        return { rows: [{
          keyword: "plombier Bruxelles",
          impressions: 80,
          clicks: 4,
          ctr: 0.05,
          position: 11.5,
          latest_date: "2026-10-22",
        }] };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("local-landing-opportunities routes", () => {
  beforeEach(() => dbCalls.splice(0));

  it("scopes both settings and GSC reads to the authenticated organization", async () => {
    const response = await request(appFor("org-a")).get("/local-landing-opportunities");
    expect(response.status).toBe(200);
    expect(response.body.opportunities).toHaveLength(1);
    expect(dbCalls).toHaveLength(2);
    expect(dbCalls.every(call => call.values[0] === "org-a")).toBe(true);
    expect(dbCalls.every(call => call.sql.includes("org_id=$1"))).toBe(true);
  });

  it("persists configuration with the authenticated organization key", async () => {
    const response = await request(appFor("org-b"))
      .put("/local-landing-opportunities/settings")
      .send({ services: ["toiture"], locations: ["Namur"], minimumImpressions: 20, maximumPosition: 25 });
    expect(response.status).toBe(200);
    expect(dbCalls).toHaveLength(1);
    expect(dbCalls[0]?.values[0]).toBe("org-b");
    expect(dbCalls[0]?.sql).toContain("ON CONFLICT (org_id)");
  });
});
