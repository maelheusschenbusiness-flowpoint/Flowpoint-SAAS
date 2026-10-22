import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock } = vi.hoisted(() => ({ orgDbMock: vi.fn() }));

vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/ai-provider.js", () => ({ aiChat: vi.fn() }));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: vi.fn(),
  resolveAIModel: vi.fn(),
}));
vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: vi.fn(),
  recordCompletedUsageDeferred: vi.fn(),
}));
vi.mock("../services/ai-quota.js", () => ({ buildQuotaGuidance: vi.fn() }));

import abTestingRouter from "./ab-testing.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", userId: "user-a", orgDb: orgDbMock });
    next();
  });
  app.use("/api", abTestingRouter);
  return app;
}

describe("A/B testing experiment lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not start an experiment until the current site's page reports the v2 snippet", async () => {
    orgDbMock.mockResolvedValue({ rows: [] });

    const response = await request(makeApp())
      .post("/api/ab-testing/experiments/exp-a/start")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/snippet FlowPoint/i);
    expect(orgDbMock).toHaveBeenCalledWith(
      expect.stringContaining("AND b.site_url=e.site_url"),
      ["exp-a", "org-a"],
    );
    const startSql = orgDbMock.mock.calls[0]?.[0] as string;
    expect(startSql).toContain("AND b.page=e.page");
    expect(startSql).toContain("b.metadata->>'version'='2'");
  });

  it("starts only an organization-owned draft after site-specific telemetry is confirmed", async () => {
    orgDbMock.mockResolvedValue({ rows: [{ id: "exp-a", status: "running", started_at: "2026-10-22T10:00:00Z" }] });

    const response = await request(makeApp())
      .post("/api/ab-testing/experiments/exp-a/start")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.experiment).toMatchObject({ id: "exp-a", status: "running" });
    expect(orgDbMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE e.id=$1 AND e.org_id=$2 AND e.status='draft'"),
      ["exp-a", "org-a"],
    );
  });

  it("returns measured, organization-scoped experiment results", async () => {
    orgDbMock
      .mockResolvedValueOnce({ rows: [{
        id: "exp-a", site_url: "https://site.example", page: "/pricing",
        name: "Pricing CTA", hypothesis: "Test wording", status: "running",
      }] })
      .mockResolvedValueOnce({ rows: [
        { event_type: "experiment_exposure", variant: "A", sessions: 80 },
        { event_type: "experiment_conversion", variant: "A", sessions: 12 },
        { event_type: "experiment_exposure", variant: "B", sessions: 82 },
        { event_type: "experiment_conversion", variant: "B", sessions: 30 },
      ] });

    const response = await request(makeApp()).get("/api/ab-testing/experiments?siteUrl=https%3A%2F%2Fsite.example");

    expect(response.status).toBe(200);
    expect(response.body.experiments[0].measurements).toEqual({
      A: { exposures: 80, conversions: 12 },
      B: { exposures: 82, conversions: 30 },
    });
    expect(response.body.experiments[0].result).toMatchObject({
      status: "significant",
      winner: "variant",
    });
    expect(orgDbMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE org_id=$1"),
      ["org-a", "https://site.example"],
    );
    expect(orgDbMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("metadata->>'experimentId'=$2"),
      ["org-a", "exp-a"],
    );
  });
});
