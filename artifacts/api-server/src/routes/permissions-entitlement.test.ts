import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (req: any, res: any, next: any) => {
    if (req.headers["x-enterprise-permissions"] === "active") next();
    else res.status(402).json({ error: "Enterprise Permissions required" });
  },
}));
vi.mock("../middlewares/requireAdmin.js", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/permissions-service.js", () => ({
  getRoles: vi.fn().mockResolvedValue([]),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  assignRole: vi.fn(),
  getPermissionLogs: vi.fn().mockResolvedValue([]),
  getAccessAudits: vi.fn().mockResolvedValue([]),
  logAccess: vi.fn(),
  getPermissionsStats: vi.fn().mockResolvedValue({}),
}));
vi.mock("../services/enterprise-permission-engine.js", () => ({
  ENTERPRISE_PERMISSION_ACTIONS: ["create", "update"],
  ENTERPRISE_PERMISSION_RESOURCES: ["reports"],
}));

import permissionsRouter from "./permissions.js";

describe("Enterprise Permissions entitlement", () => {
  const app = express();
  let server: ReturnType<typeof app.listen>;
  let baseUrl = "";

  beforeAll(async () => {
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { orgId?: string }).orgId = "org-test";
      next();
    });
    app.use("/api", permissionsRouter);
    // The shared API mounts unrelated routers after permissionsRouter.
    app.use("/api/client-mode", (_req, res) => res.json({ ok: true }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("refuses access to the role matrix when the add-on is absent", async () => {
    const response = await fetch(`${baseUrl}/api/permissions`);
    expect(response.status).toBe(402);
  });

  it("serves the matrix when the add-on is active", async () => {
    const response = await fetch(`${baseUrl}/api/permissions`, { headers: { "x-enterprise-permissions": "active" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enterprisePermissionsActive: true });
  });

  it("does not block unrelated routes mounted after the permissions router", async () => {
    const response = await fetch(`${baseUrl}/api/client-mode/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
