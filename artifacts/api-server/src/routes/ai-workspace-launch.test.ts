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

function makeApp(options: { orgId?: string; role?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: options.orgId,
      userId: "user-a",
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
    expect(response.body).toMatchObject({
      ok: true,
      strategy: completeOutput().strategy,
      roadmap: completeOutput().roadmap,
      missions: completeOutput().missions,
      missionsGenerated: 12,
      missionsVerified: 12,
      dashboardsCreated: 0,
      alertsConfigured: 0,
      reportsScheduled: 0,
    });
    const writes = queryMock.mock.calls.filter(([sql]) =>
      /INSERT INTO (onboarding_sessions|ai_workspace_profiles|ai_generated_missions|missions)/.test(String(sql)),
    );
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(([, values]) => (values as unknown[])[1] === "org-a")).toBe(true);
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

  it("rejects writes from viewers before contacting AI or the database", async () => {
    const response = await request(makeApp({ orgId: "org-a", role: "viewer" }))
      .post("/ai-workspace-launch")
      .send({ siteUrl: "https://example.test", businessName: "Example" });

    expect(response.status).toBe(403);
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
