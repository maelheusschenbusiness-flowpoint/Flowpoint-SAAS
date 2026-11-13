import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: mocks.connect },
}));
vi.mock("../middlewares/requireAdmin.js", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import ssoRouter, { publicSsoRouter } from "./sso.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a" });
    next();
  });
  app.use("/api", publicSsoRouter);
  app.use("/api", ssoRouter);
  return app;
}

describe("SSO readiness and fail-closed catalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sso_providers")) {
        return { rows: [{ id: "legacy-provider", name: "Legacy", enabled: true, provider_type: "google_workspace" }] };
      }
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  });

  it("reports no operational providers and lists every provider as unimplemented", async () => {
    const response = await request(makeApp()).get("/api/sso/capabilities");

    expect(response.status).toBe(200);
    expect(response.body.available).toEqual([]);
    expect(response.body.roadmap).toHaveLength(7);
    expect(response.body.roadmap.every((provider: { status: string }) => provider.status === "not_implemented")).toBe(true);
    expect(response.body.roadmap.some((provider: { eta?: string }) => provider.eta)).toBe(false);
  });

  it("never reports a legacy provider record as active", async () => {
    const response = await request(makeApp()).get("/api/sso/providers");

    expect(response.status).toBe(200);
    expect(response.body.providers).toEqual([
      expect.objectContaining({ id: "legacy-provider", enabled: false, availability: "not_implemented" }),
    ]);
  });

  it("rejects provider creation and SSO policy changes instead of saving fake configuration", async () => {
    const app = makeApp();
    const create = await request(app)
      .post("/api/sso/providers")
      .send({ providerType: "google_workspace", name: "Workspace" });
    const policies = await request(app).patch("/api/sso/policies").send({ enforce_sso: true });
    const config = await request(app).put("/api/sso/auth-config").send({ enforceSso: true });

    expect(create.status).toBe(501);
    expect(create.body.error).toBe("SSO_NOT_IMPLEMENTED");
    expect(policies.status).toBe(501);
    expect(policies.body.error).toBe("SSO_NOT_IMPLEMENTED");
    expect(config.status).toBe(501);
    expect(config.body.error).toBe("SSO_NOT_IMPLEMENTED");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("does not publish SAML metadata until the ACS can process assertions", async () => {
    const response = await request(makeApp()).get("/api/sso/saml/metadata");

    expect(response.status).toBe(501);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body.error).toBe("SSO_NOT_IMPLEMENTED");
  });
});
