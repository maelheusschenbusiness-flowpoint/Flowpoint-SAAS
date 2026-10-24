import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbCalls: Array<{ orgId: string; sql: string; values: unknown[] }> = [];

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import router from "./seo-change-impact.js";

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: async (sql: string, values: unknown[] = []) => {
        dbCalls.push({ orgId, sql, values });
        if (sql.includes("seo_change_impact_settings")) return { rows: [] };
        return { rows: [
          { id: "audit-new", url: "https://example.com", score: 78, issues: 2, speed: 71, status: "ok", created_at: "2026-10-22T10:00:00.000Z" },
          { id: "audit-old", url: "https://example.com", score: 63, issues: 8, speed: 55, status: "warn", created_at: "2026-10-10T10:00:00.000Z" },
        ] };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("seo-change-impact routes", () => {
  beforeEach(() => dbCalls.splice(0));

  it("compares real audit rows using only the authenticated organization", async () => {
    const response = await request(appFor("org-a")).get("/seo-change-impact").expect(200);
    expect(response.body.source).toBe("audits");
    expect(response.body.comparisons[0]).toMatchObject({
      siteUrl: "https://example.com",
      beforeAuditId: "audit-old",
      afterAuditId: "audit-new",
      scoreDelta: 15,
      criticalIssueDelta: -6,
      speedDelta: 16,
    });
    expect(dbCalls).toHaveLength(2);
    expect(dbCalls.every(call => call.values[0] === "org-a")).toBe(true);
    expect(dbCalls.every(call => call.sql.includes("org_id=$1"))).toBe(true);
  });

  it("persists validated settings for the authenticated organization", async () => {
    const response = await request(appFor("org-b"))
      .put("/seo-change-impact/settings")
      .send({ lookbackDays: 60, minimumScoreChange: 8 })
      .expect(200);
    expect(response.body.settings).toEqual({ lookbackDays: 60, minimumScoreChange: 8 });
    expect(dbCalls).toHaveLength(1);
    expect(dbCalls[0]?.values[0]).toBe("org-b");
    expect(dbCalls[0]?.sql).toContain("ON CONFLICT (org_id)");
  });

  it("rejects out-of-range settings without writing them", async () => {
    const response = await request(appFor("org-c"))
      .put("/seo-change-impact/settings")
      .send({ lookbackDays: 500, minimumScoreChange: 3 })
      .expect(400);
    expect(response.body.code).toBe("INVALID_SEO_CHANGE_IMPACT_SETTINGS");
    expect(dbCalls).toHaveLength(0);
  });
});
