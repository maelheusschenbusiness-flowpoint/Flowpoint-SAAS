import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, getPages } = vi.hoisted(() => ({
  calls: [] as Array<{ orgId: string; sql: string; values: unknown[] }>,
  getPages: vi.fn(),
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/ga4-service.js", () => ({ getGA4ConversionPages: getPages }));

import router from "./conversion-opportunity-engine.js";

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgContext: { orgId },
      orgDb: async (sql: string, values: unknown[] = []) => {
        calls.push({ orgId, sql, values });
        return { rows: [{ settings: { minimumSessions: 50, maximumConversionRate: 0.03 } }] };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("Conversion Opportunity Engine routes", () => {
  beforeEach(() => {
    calls.splice(0);
    getPages.mockResolvedValue({ rows: [
      { dimensionValues: [{ value: "/contact" }], metricValues: [{ value: "200" }, {}, { value: "2" }, { value: "0" }] },
    ] });
  });

  it("scopes settings reads and GA4 reports to the authenticated organization", async () => {
    const response = await request(appFor("org-a")).get("/conversion-opportunity-engine");
    expect(response.status).toBe(200);
    expect(response.body.opportunities[0].landingPage).toBe("/contact");
    expect(calls[0]).toMatchObject({ orgId: "org-a", values: ["org-a"] });
  });

  it("persists bounded settings under the authenticated organization", async () => {
    const response = await request(appFor("org-b"))
      .put("/conversion-opportunity-engine/settings")
      .send({ minimumSessions: -10, maximumConversionRate: 4 });
    expect(response.status).toBe(200);
    expect(response.body.settings).toEqual({ minimumSessions: 1, maximumConversionRate: 1 });
    expect(calls[0]?.orgId).toBe("org-b");
    expect(calls[0]?.sql).toContain("ON CONFLICT (org_id)");
  });
});
