import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  withOrgDb: vi.fn(),
  logActivity: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  withOrgDb: (...args: unknown[]) => mocks.withOrgDb(...args),
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../middlewares/validateMonitorUrl.js", () => ({
  validateMonitorUrl: vi.fn(),
  isPrivateHost: vi.fn(),
  checkDnsResolution: vi.fn(),
}));

vi.mock("../services/billing-service.js", () => ({
  checkQuota: vi.fn(),
}));

vi.mock("./qa-fixtures.js", () => ({
  isQaFixturesEnabled: vi.fn(() => false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mocks.loggerError, debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../services/store.js", () => ({
  store: {
    logActivity: mocks.logActivity,
    broadcast: vi.fn(),
  },
}));

import monitorRouter from "./monitors.js";

const ORG_ID = "org-monitor-delete";
const MONITOR_ID = "monitor-delete-1";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgContext = { orgId: ORG_ID, userId: "user-1", email: "owner@example.com", role: "owner" };
    next();
  });
  app.use("/api", monitorRouter);
  return app;
}

describe("DELETE /monitors/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.withOrgDb.mockImplementation(async (orgId: string, callback: (client: unknown) => Promise<unknown>) => {
      expect(orgId).toBe(ORG_ID);
      const queries: string[] = [];
      const client = {
        query: vi.fn(async (sql: string) => {
          queries.push(sql);
          if (sql.includes("SELECT * FROM monitors")) {
            return {
              rows: [{ id: MONITOR_ID, org_id: ORG_ID, name: "Homepage", url: "https://example.com" }],
              rowCount: 1,
            };
          }
          if (sql.includes("DELETE FROM monitors")) {
            return { rows: [{ id: MONITOR_ID }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        }),
      };
      const result = await callback(client);
      expect(queries).toEqual([
        expect.stringContaining("SELECT * FROM monitors"),
        expect.stringContaining("DELETE FROM monitor_checks"),
        expect.stringContaining("DELETE FROM monitor_incidents"),
        expect.stringContaining("DELETE FROM monitors"),
      ]);
      return result;
    });
  });

  it("deletes the monitor atomically and logs activity from the pre-delete snapshot", async () => {
    const response = await request(makeApp()).delete(`/api/monitors/${MONITOR_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({
      label: "Monitor supprimé : Homepage (https://example.com)",
      targetId: MONITOR_ID,
      orgId: ORG_ID,
      metadata: { name: "Homepage", url: "https://example.com" },
    }));
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("returns 404 without touching child rows when the monitor is absent", async () => {
    mocks.withOrgDb.mockImplementationOnce(async (_orgId: string, callback: (client: unknown) => Promise<unknown>) =>
      callback({
        query: vi.fn(async (sql: string) =>
          sql.includes("SELECT * FROM monitors") ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 },
        ),
      }),
    );

    const response = await request(makeApp()).delete(`/api/monitors/${MONITOR_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Monitor not found" });
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });
});