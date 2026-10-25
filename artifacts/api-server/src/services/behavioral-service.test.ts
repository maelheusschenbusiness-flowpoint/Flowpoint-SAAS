import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  checkAIQuota: vi.fn(),
  aiChat: vi.fn(),
  recordCompletedUsageDeferred: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: mocks.insert, execute: mocks.execute, select: mocks.select },
  behaviorEventsTable: {},
  behaviorSessionsTable: {},
  behaviorInsightsTable: {},
}));
vi.mock("./ai-engine.js", () => ({
  checkAIQuota: mocks.checkAIQuota,
  recordCompletedUsageDeferred: mocks.recordCompletedUsageDeferred,
}));
vi.mock("./ai-provider.js", () => ({ aiChat: mocks.aiChat }));

import {
  evaluateBehaviorFunnel, generateBehaviorInsights, summarizeBehaviorEvents, trackBehaviorEvent,
} from "./behavioral-service.js";

const event = {
  sessionId: "session-qa",
  orgId: "org-qa",
  siteUrl: "https://qa.example",
  page: "/pricing",
  eventType: "experiment_conversion" as const,
  metadata: { experimentId: "experiment-1", variant: "B" },
};

describe("behavioral event persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms the event was persisted", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values });

    await expect(trackBehaviorEvent(event)).resolves.toBe(true);
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledOnce();
  });

  it("reports database write failure instead of claiming success", async () => {
    mocks.insert.mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("database unavailable")) });

    await expect(trackBehaviorEvent(event)).resolves.toBe(false);
  });
});

describe("behavioral insight generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAIQuota.mockResolvedValue({ allowed: false });
  });

  function eventsQuery(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy, limit }) }) });
  }

  it("propagates a read failure instead of reporting success", async () => {
    mocks.select.mockImplementation(() => { throw new Error("database unavailable"); });
    await expect(generateBehaviorInsights("org-qa", "https://qa.example")).rejects.toThrow("database unavailable");
  });

  it("states measured evidence and no invented percentage impact", async () => {
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
    mocks.insert.mockReturnValue({ values });
    eventsQuery(Array.from({ length: 12 }, () => ({ eventType: "rage_click", page: "/pricing" })));

    await generateBehaviorInsights("org-qa", "https://qa.example");

    const row = values.mock.calls[0]![0];
    expect(row.insightType).toBe("rage_clicks");
    expect(row.estimatedImpact).toBe("12 rage clicks sur 7 jours (impact non chiffré)");
    expect(row.estimatedImpact).not.toMatch(/-\d+%/);
  });

  it("uses only AI recommendations linked to measured signals and without invented figures", async () => {
    mocks.checkAIQuota.mockResolvedValue({ allowed: true });
    mocks.aiChat.mockResolvedValue({
      text: JSON.stringify({ recommendations: [
        { referenceId: "E1", priority: "high", action: "Rendez le bouton plus visible.", why: "Les clics répétés sont concentrés sur cette page." },
        { referenceId: "E2", priority: "high", action: "Augmentez les ventes de 250%.", why: "Prédiction." },
      ] }),
      _ai: { model: "gpt-4o-mini", provider: "openai" },
      usage: { promptTokens: 20, completionTokens: 15 },
    });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
    mocks.insert.mockReturnValue({ values });
    eventsQuery(Array.from({ length: 12 }, () => ({ eventType: "rage_click", page: "/pricing" })));

    const result = await generateBehaviorInsights("org-qa", "https://qa.example");

    expect(result).toEqual({ aiGenerated: true, count: 1 });
    expect(values.mock.calls[0]![0].aiSuggestion).toContain("Rendez le bouton plus visible.");
    expect(values.mock.calls[0]![0].aiSuggestion).not.toContain("250%");
    expect(mocks.recordCompletedUsageDeferred).toHaveBeenCalledOnce();
  });
});
describe("behavioral funnel evaluation", () => {
  const at = (seconds: number) => new Date(seconds * 1000);
  const event = (sessionId: string, eventType: string, seconds: number, page = "/") => ({
    sessionId, eventType, page, scrollDepth: null, timeOnPage: null, createdAt: at(seconds),
  });

  it("counts only sessions that reach each configured step in order", () => {
    const result = evaluateBehaviorFunnel([
      event("s1", "page_view", 1),
      event("s1", "click", 2),
      event("s1", "form_submit", 3),
      event("s2", "page_view", 1),
      event("s2", "form_submit", 3),
      event("s3", "click", 1),
      event("s3", "page_view", 2),
      event("s3", "form_submit", 3),
    ], [
      { label: "Visit", eventType: "page_view" },
      { label: "Click", eventType: "click" },
      { label: "Submit", eventType: "form_submit" },
    ]);

    expect(result.map(step => step.sessions)).toEqual([3, 1, 1]);
    expect(result[1]?.rateFromPrevious).toBe(33.33);
    expect(result[2]?.abandonments).toBe(0);
  });

  it("applies the configured page condition and reports unavailable rates for zero denominators", () => {
    const result = evaluateBehaviorFunnel([
      event("s1", "page_view", 1, "/pricing"),
      event("s1", "form_submit", 2, "/pricing"),
    ], [
      { label: "Pricing", eventType: "page_view", page: "/pricing" },
      { label: "Contact", eventType: "form_submit", page: "/contact" },
    ]);

    expect(result[0]?.sessions).toBe(1);
    expect(result[1]?.sessions).toBe(0);
    expect(result[1]?.rateFromPrevious).toBe(0);
  });
});

describe("behavioral event summaries", () => {
  it("derives journey, entry, device, form and friction metrics from observed events", () => {
    const t = new Date("2026-10-20T12:00:00.000Z");
    const events = [
      { sessionId: "s1", page: "/", eventType: "page_view", scrollDepth: null, timeOnPage: null, createdAt: t, metadata: { referrer: "https://search.example/" } },
      { sessionId: "s1", page: "/pricing", eventType: "page_view", scrollDepth: null, timeOnPage: null, createdAt: new Date(t.getTime() + 1000), metadata: null },
      { sessionId: "s1", page: "/pricing", eventType: "rage_click", scrollDepth: null, timeOnPage: null, createdAt: new Date(t.getTime() + 2000), metadata: null },
      { sessionId: "s1", page: "/pricing", eventType: "form_submit", scrollDepth: null, timeOnPage: null, createdAt: new Date(t.getTime() + 3000), metadata: null },
      { sessionId: "s2", page: "/", eventType: "page_view", scrollDepth: null, timeOnPage: null, createdAt: t, metadata: null },
      { sessionId: "s2", page: "/", eventType: "form_abandon", scrollDepth: null, timeOnPage: null, createdAt: new Date(t.getTime() + 1000), metadata: null },
    ];
    const result = summarizeBehaviorEvents(events, [
      { id: "s1", deviceType: "mobile" },
      { id: "s2", deviceType: "desktop" },
    ], 30);

    expect(result.sessionsWithPageView).toBe(2);
    expect(result.sessionsWithFormSubmit).toBe(1);
    expect(result.journeys).toEqual([{ from: "/", to: "/pricing", sessions: 1 }]);
    expect(result.entryPages).toEqual([{ page: "/", sessions: 2 }]);
    expect(result.deviceSegments.map(x => x.device).sort()).toEqual(["desktop", "mobile"]);
    expect(result.friction.find(x => x.page === "/pricing")?.rageClicks).toBe(1);
    expect(result.referrerSegments).toEqual([{ referrerHost: "search.example", sessions: 1 }]);
  });
});
