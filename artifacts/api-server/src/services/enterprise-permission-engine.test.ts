import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query } }));

import { pool } from "@workspace/db";
import { canWrite } from "../middlewares/requireRole.js";
import { hasRolePermission, requestPermission, resolveEnterprisePermission } from "./enterprise-permission-engine.js";

describe("enterprise permission engine", () => {
  afterEach(() => vi.clearAllMocks());

  it("maps resource routes to explicit matrix actions", () => {
    expect(requestPermission("POST", "/api/reports/123")).toEqual({ resource: "reports", action: "create" });
    expect(requestPermission("DELETE", "/api/keywords/123")).toEqual({ resource: "keywords", action: "delete" });
    expect(requestPermission("POST", "/api/billing/invoices")).toEqual({ resource: "__unsupported__", action: "create" });
  });

  it("accepts only explicit permissions from a custom role", () => {
    expect(hasRolePermission({ reports: ["view", "create"] }, "reports", "create")).toBe(true);
    expect(hasRolePermission({ reports: ["view"] }, "reports", "create")).toBe(false);
    expect(hasRolePermission({ reports: ["delete"] }, "reports", "delete")).toBe(false);
    expect(hasRolePermission("{broken", "reports", "create")).toBe(false);
  });

  it("does not apply custom permissions when the add-on is absent", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(resolveEnterprisePermission("org-a", "user-a", undefined, "reports", "create")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(["org-a"]);
  });

  it("loads a role only inside the requesting organization", async () => {
    query.mockResolvedValueOnce({ rows: [{ active: true }] });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(resolveEnterprisePermission("org-a", "user-a", undefined, "reports", "create")).resolves.toBeNull();
    expect(query.mock.calls[1]?.[0]).toContain("tm.org_id=$1");
    expect(query.mock.calls[1]?.[1]).toEqual(["org-a", "user-a"]);
  });

  it("uses the assigned tenant role to authorize an allowed action", async () => {
    query.mockResolvedValueOnce({ rows: [{ active: true }] });
    query.mockResolvedValueOnce({ rows: [{ permissions: { reports: ["view", "create"] } }] });
    await expect(resolveEnterprisePermission("org-a", "user-a", undefined, "reports", "create")).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("enforces the resolved custom permission on a real canWrite route", async () => {
    query.mockResolvedValueOnce({ rows: [{ active: true }] });
    query.mockResolvedValueOnce({ rows: [{ permissions: { reports: ["create"] } }] });
    const app = express();
    app.use((req, _res, next) => {
      req.orgId = "org-a";
      req.orgContext = { orgId: "org-a", userId: "user-a", role: "member" };
      (req as express.Request & { me?: { plan?: string } }).me = { plan: "Standard" };
      next();
    });
    app.post("/api/reports", canWrite, (_req, res) => res.sendStatus(200));

    const response = await request(app).post("/api/reports");
    expect(response.status).toBe(200);
    expect(query.mock.calls[1]?.[1]).toEqual(["org-a", "user-a"]);
  });

  it("rejects a canWrite action omitted from the active custom role", async () => {
    query.mockResolvedValueOnce({ rows: [{ active: true }] });
    query.mockResolvedValueOnce({ rows: [{ permissions: { reports: ["update"] } }] });
    const app = express();
    app.use((req, _res, next) => {
      req.orgId = "org-a";
      req.orgContext = { orgId: "org-a", userId: "user-a", role: "member" };
      (req as express.Request & { me?: { plan?: string } }).me = { plan: "Standard" };
      next();
    });
    app.post("/api/reports", canWrite, (_req, res) => res.sendStatus(200));

    const response = await request(app).post("/api/reports");
    expect(response.status).toBe(403);
  });
});
