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
import router from "./agency-portfolio-priorities.js";

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: async (sql: string, values: unknown[] = []) => {
        dbCalls.push({ orgId, sql, values });
        if (sql.includes("agency_portfolio_priority_settings")) return { rows: [] };
        if (sql.includes("gsc_page_data")) return { rows: [{ page: "https://example.com/a", clicks: 245 }] };
        return { rows: [
          { id: "new", url: "https://example.com", score: 74, issues: 2, created_at: "2026-10-22T10:00:00Z" },
          { id: "old", url: "https://example.com", score: 83, issues: 0, created_at: "2026-10-01T10:00:00Z" },
        ] };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("agency-portfolio-priorities routes", () => {
  beforeEach(() => dbCalls.splice(0));

  it("ranks only tenant audits and reports measured GSC clicks", async () => {
    const response = await request(appFor("org-a")).get("/agency-portfolio-priorities").expect(200);
    expect(response.body.source).toBe("audits+gsc_page_data");
    expect(response.body.priorities[0]).toMatchObject({
      domain: "example.com", currentScore: 74, previousScore: 83, monthlyOrganicClicks: 245, priority: "urgent",
    });
    expect(dbCalls).toHaveLength(3);
    expect(dbCalls.every(call => call.values[0] === "org-a" && call.sql.includes("org_id=$1"))).toBe(true);
  });

  it("persists validated weights by organization and rejects invalid values", async () => {
    const saved = await request(appFor("org-b"))
      .put("/agency-portfolio-priorities/settings")
      .send({ priorityWeights: { "example.com": 5 } })
      .expect(200);
    expect(saved.body.settings.priorityWeights).toEqual({ "example.com": 5 });
    expect(dbCalls[0]?.values[0]).toBe("org-b");
    expect(dbCalls[0]?.sql).toContain("ON CONFLICT (org_id)");
    dbCalls.splice(0);
    const invalid = await request(appFor("org-c"))
      .put("/agency-portfolio-priorities/settings")
      .send({ priorityWeights: { "example.com": 9 } })
      .expect(400);
    expect(invalid.body.code).toBe("INVALID_AGENCY_PORTFOLIO_SETTINGS");
    expect(dbCalls).toHaveLength(0);
  });
});
