import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: queryMock } }));
vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import dataExplorerRouter from "./data-explorer.js";

function appFor(orgId: string) {
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { orgId, userId: "user" }); next(); });
  app.use(dataExplorerRouter);
  return app;
}

describe("Data Explorer dashboard organization isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only dashboards through the requesting organization's scope", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: "dash-a", name: "Org A dashboard", widgets: [] }] });

    const response = await request(appFor("org-a")).get("/dashboards");

    expect(response.status).toBe(200);
    expect(response.body.dashboards).toEqual([{ id: "dash-a", name: "Org A dashboard", widgets: [] }]);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("FROM custom_dashboards WHERE org_id=$1"), ["org-a"]);
  });

  it("does not allow another organization to delete a dashboard by ID", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    const response = await request(appFor("org-b")).delete("/dashboards/dash-a");

    expect(response.status).toBe(404);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM custom_dashboards WHERE id=$1 AND org_id=$2"), ["dash-a", "org-b"]);
  });
});
