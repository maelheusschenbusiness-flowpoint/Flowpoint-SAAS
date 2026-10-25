import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), execute: vi.fn(), select: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { insert: mocks.insert, execute: mocks.execute, select: mocks.select },
  behaviorEventsTable: {},
  behaviorSessionsTable: {},
  behaviorInsightsTable: {},
}));

import { generateBehaviorInsights, trackBehaviorEvent } from "./behavioral-service.js";

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
  beforeEach(() => vi.clearAllMocks());

  function eventsQuery(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });
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
});
