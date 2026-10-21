import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getWorkflowsDataMock, executeWorkflowMock } = vi.hoisted(() => ({
  getWorkflowsDataMock: vi.fn(),
  executeWorkflowMock: vi.fn(),
}));

vi.mock("../services/automation-service.js", () => ({
  getWorkflowsData: getWorkflowsDataMock,
  executeWorkflow: executeWorkflowMock,
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, _res: any, next: any) => next(),
}));

import automationRouter from "./automation.js";

describe("AI Workflows tenant isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never reads the shared default tenant when an org-scoped read fails", async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, {
        orgId: "org-a",
        orgDb: async () => { throw new Error("database unavailable"); },
      });
      next();
    });
    app.use(automationRouter);

    const response = await request(app).get("/automation/workflows");

    expect(response.status).toBe(503);
    expect(response.body.workflows).toEqual([]);
    expect(getWorkflowsDataMock).not.toHaveBeenCalled();
  });
});
