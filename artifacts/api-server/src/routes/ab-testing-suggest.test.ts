import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgDb: vi.fn(),
  aiChat: vi.fn(),
  checkAIQuota: vi.fn(),
  recordCompletedUsageDeferred: vi.fn(),
  loadOrgAIPrefs: vi.fn(),
  resolveAIModel: vi.fn(),
  buildQuotaGuidance: vi.fn(),
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/ai-provider.js", () => ({ aiChat: mocks.aiChat }));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: mocks.loadOrgAIPrefs,
  resolveAIModel: mocks.resolveAIModel,
}));
vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: mocks.checkAIQuota,
  recordCompletedUsageDeferred: mocks.recordCompletedUsageDeferred,
}));
vi.mock("../services/ai-quota.js", () => ({ buildQuotaGuidance: mocks.buildQuotaGuidance }));

import abTestingRouter from "./ab-testing.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", userId: "user-a", orgDb: mocks.orgDb });
    next();
  });
  app.use("/api", abTestingRouter);
  return app;
}

const body = {
  siteUrl: "https://site.example",
  page: "/pricing",
  selector: "#main-cta",
  goalSelector: "form#contact button",
  variantAText: "Get in touch",
};
const proposal = {
  hypothesis: "A clearer CTA may improve form starts.",
  variantBText: "Book a short demo",
  rationale: "The page has repeated rage clicks.",
  successMetric: "Form submissions per exposed session",
};

describe("POST /ab-testing/suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgDb.mockImplementation(async (sql: string) => {
      if (sql.includes("behavior_site_tokens")) return { rows: [{ owned: 1 }] };
      return { rows: [{ eventType: "rage_click", events: 3, sessions: 2 }] };
    });
    mocks.checkAIQuota.mockResolvedValue({ allowed: true });
    mocks.loadOrgAIPrefs.mockResolvedValue({});
    mocks.resolveAIModel.mockReturnValue({ provider: "openai", model: "gpt-4o-mini", maxTokens: 500 });
    mocks.aiChat.mockResolvedValue({
      text: JSON.stringify(proposal),
      usage: { promptTokens: 50, completionTokens: 20 },
    });
    mocks.buildQuotaGuidance.mockReturnValue({ error: "quota" });
  });

  it("uses owned site's aggregated signals and returns a validated suggestion", async () => {
    const response = await request(makeApp()).post("/api/ab-testing/suggest").send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, source: "behavior_events", suggestion: proposal });
    expect(mocks.orgDb).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("COUNT(DISTINCT session_id)"),
      ["org-a", "https://site.example", "/pricing"],
    );
    expect(mocks.checkAIQuota).toHaveBeenCalledWith({ feature: "strategist", orgId: "org-a" });
    expect(mocks.recordCompletedUsageDeferred).toHaveBeenCalledWith(expect.objectContaining({
      feature: "strategist", orgId: "org-a", userId: "user-a", success: true,
    }));
  });

  it("does not analyze a site owned by another organization", async () => {
    mocks.orgDb.mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp()).post("/api/ab-testing/suggest").send(body);

    expect(response.status).toBe(404);
    expect(mocks.aiChat).not.toHaveBeenCalled();
    expect(mocks.checkAIQuota).not.toHaveBeenCalled();
  });

  it("requires real recent signals before calling the model", async () => {
    mocks.orgDb.mockResolvedValueOnce({ rows: [{ owned: 1 }] }).mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp()).post("/api/ab-testing/suggest").send(body);

    expect(response.status).toBe(409);
    expect(mocks.aiChat).not.toHaveBeenCalled();
    expect(mocks.checkAIQuota).not.toHaveBeenCalled();
  });

  it("respects the existing strategist quota without calling the model", async () => {
    mocks.checkAIQuota.mockResolvedValue({ allowed: false });

    const response = await request(makeApp()).post("/api/ab-testing/suggest").send(body);

    expect(response.status).toBe(402);
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });
});
