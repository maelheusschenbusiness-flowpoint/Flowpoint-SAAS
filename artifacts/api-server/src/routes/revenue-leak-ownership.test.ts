import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ orgDb: vi.fn() }));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import revenueLeakRouter from "./revenue-leak.js";

const SITE_URL = "https://customer.example";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: mocks.orgDb });
    next();
  });
  app.use("/api", revenueLeakRouter);
  return app;
}

describe("Revenue Leak site ownership errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgDb.mockImplementation(async (sql: string) => {
      if (sql.includes("behavior_site_tokens")) return { rows: [{ owned: 1 }] };
      return { rows: [] };
    });
  });

  it("allows a site owned by the current organization", async () => {
    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(mocks.orgDb).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND site_url = $2"),
      ["org-a", SITE_URL],
    );
  });

  it("returns the same generic 404 for missing and non-owned sites", async () => {
    mocks.orgDb.mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Site not found" });
    expect(JSON.stringify(response.body)).not.toContain("org-b");
  });

  it("returns 503 rather than a false 404 when ownership verification fails", async () => {
    mocks.orgDb.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await request(makeApp())
      .get("/api/revenue-leak")
      .query({ siteUrl: SITE_URL });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/could not be verified/i);
    expect(JSON.stringify(response.body)).not.toContain("database unavailable");
  });

  it("also returns 503 for technical failures on detect without exposing site existence", async () => {
    mocks.orgDb.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await request(makeApp())
      .post("/api/revenue-leak/detect")
      .send({ siteUrl: SITE_URL });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/could not be verified/i);
    expect(JSON.stringify(response.body)).not.toContain("database unavailable");
  });
});
