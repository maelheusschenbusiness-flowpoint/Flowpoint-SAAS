import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "@workspace/db";
import { customDomainHost } from "./customDomainHost.js";

const mockQuery = vi.mocked(pool.query);

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use((req, _res, next) => {
    req.orgId = "org-a";
    req.userId = "user-a";
    next();
  });
  app.use(customDomainHost);
  app.use((req, res) => {
    res.json({ orgId: req.orgId, domainContext: req.customDomainContext ?? null });
  });
  return app;
}

describe("custom-domain tenant routing", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("keeps the matching workspace on its verified HTTPS host", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: "org-a" }] } as never);
    const res = await request(buildApp())
      .get("/dashboard")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toEqual({ domain: "portal.example.com", orgId: "org-a" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects a session from a different organization", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ org_id: "org-b" }] } as never);
    const res = await request(buildApp())
      .get("/api/me")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(421);
    expect(res.body.error).toMatch(/workspace/i);
  });

  it("does not query the database for FlowPoint platform hosts", async () => {
    const res = await request(buildApp())
      .get("/dashboard")
      .set("Host", "flowpoint-test.onrender.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body.domainContext).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("serves the one-time TLS routing probe only for Render-confirmed domains", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "cd_test", domain: "portal.example.com" }],
    } as never);
    const res = await request(buildApp())
      .get("/api/.well-known/flowpoint-domain-proof")
      .set("Host", "portal.example.com")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: "cd_test", domain: "portal.example.com" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
