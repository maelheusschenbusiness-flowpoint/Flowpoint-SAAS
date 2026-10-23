import { describe, expect, it } from "vitest";
import { rankAgencyPortfolioPriorities } from "./agency-portfolio-priorities.js";

const site = (overrides: Partial<Parameters<typeof rankAgencyPortfolioPriorities>[0][number]> = {}) => ({
  siteId: "site-1",
  domain: "example.com",
  currentScore: 80,
  previousScore: 80,
  criticalIssues: 0,
  monthlyOrganicSessions: 2500,
  priorityWeight: 3,
  ...overrides,
});

describe("Agency Portfolio Priorities", () => {
  it("ranks urgent measured risks ahead of focus and stable sites", () => {
    const result = rankAgencyPortfolioPriorities([
      site({ siteId: "stable", domain: "stable.test" }),
      site({ siteId: "drop", domain: "drop.test", currentScore: 65, previousScore: 72 }),
      site({ siteId: "critical", domain: "critical.test", criticalIssues: 2 }),
    ]);
    expect(result.map(item => item.siteId)).toEqual(["critical", "drop", "stable"]);
    expect(result[0].reasons).toContain("2 critical technical issues");
    expect(result[1].reasons).toContain("SEO score fell by 7 points");
  });

  it("uses user priority weight only after measured urgency signals", () => {
    const result = rankAgencyPortfolioPriorities([
      site({ siteId: "lower", domain: "lower.test", currentScore: 58, previousScore: null, priorityWeight: 2 }),
      site({ siteId: "higher", domain: "higher.test", currentScore: 58, previousScore: null, priorityWeight: 5 }),
    ]);
    expect(result.map(item => item.siteId)).toEqual(["higher", "lower"]);
  });

  it("rejects impossible or missing metrics instead of inventing a rank", () => {
    expect(() => rankAgencyPortfolioPriorities([site({ currentScore: 130 })])).toThrow(RangeError);
    expect(rankAgencyPortfolioPriorities([])).toEqual([]);
  });
});
