import { describe, expect, it } from "vitest";
import { evaluateOrganicCampaignGoal } from "./organic-campaign-tracker.js";

const goal = { keyword: "plumber brussels", targetPosition: 5, minimumClicks: 20 };

describe("Organic Campaign Tracker", () => {
  it("compares campaign targets with observed GSC metrics", () => {
    const result = evaluateOrganicCampaignGoal(goal, {
      keyword: "Plumber Brussels",
      clicks: 24,
      impressions: 410,
      averagePosition: 4.2,
      observedAt: "2026-10-20",
    });
    expect(result).toMatchObject({
      status: "goal_met",
      clicksGap: -4,
      observedAt: "2026-10-20",
    });
    expect(result.positionGap).toBeCloseTo(-0.8);
  });

  it("does not estimate performance when the keyword has no matching observations", () => {
    expect(evaluateOrganicCampaignGoal(goal, null).status).toBe("no_data");
    expect(evaluateOrganicCampaignGoal(goal, {
      keyword: "different query",
      clicks: 90,
      impressions: 1000,
      averagePosition: 1,
      observedAt: "2026-10-20",
    }).clicks).toBeNull();
  });

  it("rejects invalid targets and measured values", () => {
    expect(() => evaluateOrganicCampaignGoal({ ...goal, targetPosition: 0 }, null)).toThrow(RangeError);
    expect(() => evaluateOrganicCampaignGoal(goal, {
      keyword: goal.keyword,
      clicks: -1,
      impressions: 100,
      averagePosition: 2,
      observedAt: "2026-10-20",
    })).toThrow(RangeError);
  });
});
