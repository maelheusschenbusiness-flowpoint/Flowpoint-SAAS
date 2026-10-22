import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), execute: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { insert: mocks.insert, execute: mocks.execute },
  behaviorEventsTable: {},
  behaviorSessionsTable: {},
  behaviorInsightsTable: {},
}));

import { trackBehaviorEvent } from "./behavioral-service.js";

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
