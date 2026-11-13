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
import router from "./organic-campaign-tracker.js";

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: async (sql: string, values: unknown[] = []) => {
        dbCalls.push({ orgId, sql, values });
        if (sql.includes("gsc_keyword_data")) {
          return { rows: [{
            keyword: "Plumber Brussels", clicks: 24, impressions: 410,
            average_position: 4.2, observed_at: "2026-10-20",
          }] };
        }
        if (sql.startsWith("SELECT")) {
          return { rows: [{
            id: "campaign-1", keyword: "plumber brussels",
            target_position: 5, minimum_clicks: 20,
          }] };
        }
        if (sql.startsWith("DELETE")) return { rows: [], rowCount: 1 };
        return { rows: [{
          id: "campaign-2", keyword: "plumber brussels",
          target_position: 5, minimum_clicks: 20,
        }], rowCount: 1 };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("organic-campaign-tracker routes", () => {
  beforeEach(() => dbCalls.splice(0));

  it("evaluates saved goals using only tenant GSC observations", async () => {
    const response = await request(appFor("org-a")).get("/organic-campaign-tracker").expect(200);
    expect(response.body.source).toBe("gsc_keyword_data");
    expect(response.body.campaigns[0]).toMatchObject({
      keyword: "plumber brussels", status: "goal_met", clicks: 24, impressions: 410,
    });
    expect(dbCalls).toHaveLength(2);
    expect(dbCalls.every(call => call.values[0] === "org-a" && call.sql.includes("org_id=$1"))).toBe(true);
  });

  it("persists a validated campaign goal within the active organization", async () => {
    const response = await request(appFor("org-b"))
      .post("/organic-campaign-tracker")
      .send({ keyword: "plumber brussels", targetPosition: 5, minimumClicks: 20 })
      .expect(200);
    expect(response.body.campaign.keyword).toBe("plumber brussels");
    expect(dbCalls[0]?.values[1]).toBe("org-b");
    expect(dbCalls[0]?.sql).toContain("ON CONFLICT (org_id, keyword)");
  });

  it("rejects invalid goals and scopes deletion by organization", async () => {
    await request(appFor("org-c"))
      .post("/organic-campaign-tracker")
      .send({ keyword: "", targetPosition: 0, minimumClicks: -1 })
      .expect(400);
    expect(dbCalls).toHaveLength(0);
    await request(appFor("org-c")).delete("/organic-campaign-tracker/campaign-1").expect(200);
    expect(dbCalls[0]?.values).toEqual(["campaign-1", "org-c"]);
    expect(dbCalls[0]?.sql).toContain("org_id=$2");
  });
});
