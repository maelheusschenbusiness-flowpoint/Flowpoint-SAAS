import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectMock,
  queryMock,
  releaseMock,
  aiChatMock,
  checkQuotaMock,
  recordUsageMock,
  logActivityMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  aiChatMock: vi.fn(),
  checkQuotaMock: vi.fn(),
  recordUsageMock: vi.fn(),
  logActivityMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { connect: connectMock } }));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/ai-provider.js", () => ({ aiChat: aiChatMock }));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: vi.fn().mockResolvedValue({}),
  resolveAIModel: vi.fn().mockReturnValue({
    provider: "openai", model: "gpt-4o-mini", maxTokens: 4000,
  }),
}));
vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: checkQuotaMock,
  recordCompletedUsageDeferred: recordUsageMock,
}));
vi.mock("../services/ai-quota.js", () => ({
  buildQuotaGuidance: vi.fn(),
}));
vi.mock("../services/store.js", () => ({
  store: { logActivity: logActivityMock },
}));

import workspaceLaunchRouter from "./ai-workspace-launch.js";

function completeOutput() {
  return {
    strategy: "Prioriser les pages locales et mesurer les conversions.",
    roadmap: Array.from({ length: 5 }, (_, index) => ({
      priority: index + 1,
      label: `Action réelle ${index + 1}`,
      impact: "Impact à mesurer",
      tag: "SEO",
    })),
    missions: Array.from({ length: 12 }, (_, index) => ({
      title: `Mission réelle ${index + 1}`,
      category: "seo",
      priority: index + 1,
      impact: "Résultat à mesurer",
      effort: "2h",
    })),
  };
}

function makeApp(options: { orgId?: string; role?: string; noUser?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: options.orgId,
      userId: options.noUser ? undefined : "user-a",
      orgContext: options.role ? { role: options.role, userId: "user-a" } : undefined,
    });
    next();
  });
  app.use(workspaceLaunchRouter);
  return app;
}

describe("AI Workspace Launch persisted flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkQuotaMock.mockResolvedValue({ allowed: true });
    aiChatMock.mockResolvedValue({
      text: JSON.stringify(completeOutput()),
      usage: { promptTokens: 100, completionTokens: 200 },
    });
    connectMock.mockResolvedValue({ query: queryMock, release: releaseMock });
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (String(sql).includes("SELECT id FROM missions")) {
        return { rows: ((values?.[1] as string[]) ?? []).map(id => ({ id })) };
      }
      if (String(sql).includes("AS dashboards") && String(sql).includes("AS alerts")) {
        return { rows: [{
          dashboards: values?.[1] ? 1 : 0,
          alerts: values?.[2] ? 1 : 0,
        }] };
      }
      if (String(sql).includes("FROM ai_workspace_profiles")) {
        return { rows: [{
          generated_roadmap: completeOutput().roadmap,
          generated_strategy: completeOutput().strategy,
        }] };
      }
      if (String(sql).includes("FROM ai_generated_missions")) {
        return { rows: completeOutput().missions.map(mission => ({
          title: mission.title,
          category: mission.category,
          priority: mission.priority,
          estimated_impact: mission.impact,
          estimated_effort: mission.effort,
        })) };
      }
      return { rows: [] };
    });
  });

  it("returns the generated content only after tenant-scoped missions are verified", async () => {
    const response = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .send({ siteUrl: "https://example.test", businessName: "Example", niche: "services" });

    expect(response.status).toBe(200);
    expect(aiChatMock.mock.calls[0]?.[0].messages[0].content).toContain("N'invente aucun pourcentage");
    expect(aiChatMock.mock.calls[0]?.[0].messages[0].content).not.toContain("+20% trafic local");
    expect(response.body).toMatchObject({
      ok: true,
      strategy: completeOutput().strategy,
      roadmap: completeOutput().roadmap,
      missions: completeOutput().missions,
      missionsGenerated: 12,
      missionsVerified: 12,
      dashboardsCreated: 1,
      alertsConfigured: 1,
      reportsScheduled: 0,
      configuredModules: ["seo_dashboard", "seo_alert"],
      readinessChecks: expect.arrayContaining([
        expect.objectContaining({ id: "profile", status: "ready" }),
        expect.objectContaining({ id: "objectives", status: "needs_attention" }),
        expect.objectContaining({ id: "seo_dashboard", status: "ready" }),
        expect.objectContaining({ id: "seo_alert", status: "ready" }),
      ]),
    });
    const writes = queryMock.mock.calls.filter(([sql]) =>
      /INSERT INTO (onboarding_sessions|ai_workspace_profiles|ai_generated_missions|missions|custom_dashboards|alert_rules)/.test(String(sql)),
    );
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(([, values]) => (values as unknown[])[1] === "org-a")).toBe(true);
    expect(writes.some(([sql]) => String(sql).includes("INSERT INTO custom_dashboards"))).toBe(true);
    expect(writes.some(([sql]) => String(sql).includes("INSERT INTO alert_rules"))).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND id = ANY($2::text[])"),
      ["org-a", expect.any(Array)],
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id = $1 AND profile_id = $2"),
      ["org-a", expect.any(String)],
    );
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("creates only the selected alert module and persists its configured threshold", async () => {
    const response = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .send({
        siteUrl: "https://example.test",
        businessName: "Example",
        goals: ["Generate qualified leads"],
        modules: ["seo_alert"],
        alertThreshold: 65,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      configuredModules: ["seo_alert"],
      dashboardsCreated: 0,
      alertsConfigured: 1,
      dashboard: null,
      alertRule: { id: expect.stringMatching(/^awl_alert_/), threshold: 65 },
      readinessChecks: expect.arrayContaining([
        expect.objectContaining({ id: "objectives", status: "ready" }),
        expect.objectContaining({ id: "seo_dashboard", status: "not_selected" }),
      ]),
    });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO custom_dashboards"))).toBe(false);
    const alertInsert = queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO alert_rules"));
    expect(alertInsert?.[1]?.[3]).toBe(65);
  });

  it("rejects writes from viewers before contacting AI or the database", async () => {
    const response = await request(makeApp({ orgId: "org-a", role: "viewer" }))
      .post("/ai-workspace-launch")
      .send({ siteUrl: "https://example.test", businessName: "Example" });

    expect(response.status).toBe(403);
    expect(aiChatMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("rejects malformed or oversized profiles before quota, AI, or database work", async () => {
    const invalidList = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .send({ goals: "not-an-array" });
    const oversizedText = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .send({ businessName: "x".repeat(161) });
    const invalidModules = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .send({ modules: ["unapproved_module"] });
    const invalidThreshold = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .send({ alertThreshold: 101 });
    const malformedBody = await request(makeApp({ orgId: "org-a", role: "owner" }))
      .post("/ai-workspace-launch")
      .set("content-type", "application/json")
      .send("null");

    expect(invalidList.status).toBe(400);
    expect(oversizedText.status).toBe(400);
    expect(invalidModules.status).toBe(400);
    expect(invalidThreshold.status).toBe(400);
    expect(malformedBody.status).toBe(400);
    expect(invalidList.body.code).toBe("INVALID_PROFILE");
    expect(oversizedText.body.code).toBe("INVALID_PROFILE");
    expect(invalidModules.body.code).toBe("INVALID_PROFILE");
    expect(invalidThreshold.body.code).toBe("INVALID_PROFILE");
    expect(checkQuotaMock).not.toHaveBeenCalled();
    expect(aiChatMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("rejects writes without an organization context", async () => {
    const response = await request(makeApp({ role: "owner" }))
      .post("/ai-workspace-launch")
      .send({ siteUrl: "https://example.test", businessName: "Example" });

    expect(response.status).toBe(401);
    expect(checkQuotaMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("rejects writes without an authenticated user instead of defaulting to an anonymous identity", async () => {
    const response = await request(makeApp({ orgId: "org-a", role: "owner", noUser: true }))
      .post("/ai-workspace-launch")
      .send({ siteUrl: "https://example.test", businessName: "Example" });

    expect(response.status).toBe(401);
    expect(checkQuotaMock).not.toHaveBeenCalled();
    expect(aiChatMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("returns only the session and generated missions belonging to the requesting organization", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: "session-a",
          org_id: "org-a",
          profile_id: "profile-a",
          generated_strategy: "Stratégie persistée",
          generated_roadmap: completeOutput().roadmap,
          mission_count: 1,
          metadata: {
            selectedModules: ["seo_dashboard"],
            readinessChecks: [{ id: "profile", label: "Business profile", status: "ready" }],
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "mission-a",
          title: "Mission persistée",
          category: "seo",
          priority: 1,
          impact: "Mesurable",
          effort: "2h",
          status: "pending",
        }],
      });

    const response = await request(makeApp({ orgId: "org-a" }))
      .get("/ai-workspace-launch/session-a");

    expect(response.status).toBe(200);
    expect(response.body.missions).toEqual([expect.objectContaining({ id: "mission-a" })]);
    expect(response.body.configuredModules).toEqual(["seo_dashboard"]);
    expect(response.body.readinessChecks).toEqual([
      { id: "profile", label: "Business profile", status: "ready" },
    ]);
    expect(queryMock.mock.calls[0]).toEqual([
      expect.stringContaining("WHERE s.id = $1 AND s.org_id = $2"),
      ["session-a", "org-a"],
    ]);
    expect(queryMock.mock.calls[1]).toEqual([
      expect.stringContaining("WHERE org_id = $1 AND profile_id = $2"),
      ["org-a", "profile-a"],
    ]);
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("does not query missions when a session belongs to another organization", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const response = await request(makeApp({ orgId: "org-b" }))
      .get("/ai-workspace-launch/session-a");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("SESSION_NOT_FOUND");
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE s.id = $1 AND s.org_id = $2"),
      ["session-a", "org-b"],
    );
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
