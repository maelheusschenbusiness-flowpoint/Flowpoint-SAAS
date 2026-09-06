import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const dbCalls: Array<{ sql: string; values?: unknown[] }> = [];
let dbFailure = false;

const { default: onboardingRouter } = await import("./onboarding.js");

function makeApp(orgId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (orgId) {
      req.orgContext = { orgId };
      req.orgDb = async (sql: string, values?: unknown[]) => {
        dbCalls.push({ sql, values });
        if (dbFailure) throw new Error("temporary database outage");
        return { rows: [], rowCount: 1 };
      };
    }
    next();
  });
  app.use("/api", onboardingRouter);
  return app;
}

describe("onboarding completion persistence", () => {
  it("writes completion through the authenticated organization DB context", async () => {
    dbCalls.length = 0;
    dbFailure = false;

    const response = await request(makeApp("10000000-0000-4000-8000-000000000003"))
      .post("/api/onboarding/complete");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.completedAt).toEqual(expect.any(String));
    expect(dbCalls).toHaveLength(1);
    expect(dbCalls[0].sql).toContain("onboardingCompletedAt");
    expect(dbCalls[0].values).toEqual([
      "10000000-0000-4000-8000-000000000003",
      response.body.completedAt,
    ]);
  });

  it("returns a retryable error instead of acknowledging a failed write", async () => {
    dbCalls.length = 0;
    dbFailure = true;

    const response = await request(makeApp("10000000-0000-4000-8000-000000000003"))
      .post("/api/onboarding/complete");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      error: "onboarding_persistence_unavailable",
    });
  });

  it("rejects completion without an organization context", async () => {
    dbFailure = false;
    const response = await request(makeApp()).post("/api/onboarding/complete");
    expect(response.status).toBe(401);
  });
});