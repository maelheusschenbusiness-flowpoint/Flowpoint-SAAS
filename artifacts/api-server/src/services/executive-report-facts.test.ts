import { describe, expect, it } from "vitest";
import { buildExecutiveReportFacts } from "./executive-report-facts.js";

describe("buildExecutiveReportFacts", () => {
  it("computes only metrics supported by supplied audit and monitor rows", () => {
    const facts = buildExecutiveReportFacts(
      [{ url: "https://a.example/path", score: 80, created_at: "2026-10-01" }, { url: "https://a.example", score: 70 }],
      [{ name: "web", url: "https://a.example", status: "up", uptime: 99.5, response_time: 120 }, { status: "down", uptime: 101 }],
    );
    expect(facts.measured).toEqual({
      auditsIncluded: 2, latestAuditScore: 80, previousAuditScore: 70, scoreChange: 10,
      monitorsIncluded: 2, monitorsDown: 1, averageUptime: 99.5,
    });
    expect(facts.audits[0]?.domain).toBe("a.example");
  });

  it("does not invent missing measurements or accept invalid scores", () => {
    const facts = buildExecutiveReportFacts([{ score: 120 }], []);
    expect(facts.measured).toEqual({
      auditsIncluded: 0, latestAuditScore: null, previousAuditScore: null, scoreChange: null,
      monitorsIncluded: 0, monitorsDown: 0, averageUptime: null,
    });
  });

  it("does not convert missing database metrics to zero and preserves a measured zero", () => {
    const facts = buildExecutiveReportFacts(
      [{ score: null }, { score: "" }, { score: 0 }],
      [
        { name: "missing", status: "up", uptime: null, response_time: null },
        { name: "measured-zero", status: "down", uptime: 0, response_time: 0 },
      ],
    );
    expect(facts.audits).toHaveLength(1);
    expect(facts.measured).toEqual({
      auditsIncluded: 1, latestAuditScore: 0, previousAuditScore: null, scoreChange: null,
      monitorsIncluded: 2, monitorsDown: 1, averageUptime: 0,
    });
    expect(facts.monitors.map(monitor => [monitor.uptime, monitor.responseTimeMs])).toEqual([
      [null, null],
      [0, 0],
    ]);
  });

  it("includes GA4 property totals and scoped Search Console page measurements", () => {
    const facts = buildExecutiveReportFacts([], [], {
      ga4: { totals: [{ metricValues: [
        { value: "120" }, { value: "90" }, { value: "25" }, { value: "0.4" }, { value: "0.6" }, { value: "90" }, { value: "750" }, { value: "8" },
      ] }] },
      searchConsolePages: [
        { page: "https://a.example/", clicks: 20, impressions: 1000, avg_position: 2.2 },
        { page: "https://a.example/about", clicks: 10, impressions: 500, avg_position: 4 },
      ],
    });
    expect(facts.analytics.ga4).toMatchObject({ status: "observed", sessions: 120, users: 90, conversions: 8, pageViews: 750, periodDays: 30 });
    expect(facts.analytics.searchConsole).toMatchObject({ status: "observed", scope: "top_5_synced_pages", pagesIncluded: 2, sampledClicks: 30, sampledImpressions: 1500, weightedAveragePosition: 2.8, clickThroughRate: 0.02 });
  });

  it("keeps missing analytics unknown while preserving explicit measured zeros", () => {
    const missing = buildExecutiveReportFacts([], [], { ga4: { totals: [] }, searchConsolePages: [] });
    expect(missing.analytics.ga4).toMatchObject({ status: "unavailable", sessions: null, conversions: null });
    expect(missing.analytics.searchConsole).toMatchObject({ status: "unavailable", sampledClicks: null, sampledImpressions: null });
    const zero = buildExecutiveReportFacts([], [], {
      ga4: { totals: [{ metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }, { value: "0" }, { value: "0" }, { value: "0" }, { value: "0" }, { value: "0" }] }] },
      searchConsolePages: [{ page: "https://a.example/", clicks: 0, impressions: 0, avg_position: null }],
    });
    expect(zero.analytics.ga4).toMatchObject({ status: "observed", sessions: 0, conversions: 0 });
    expect(zero.analytics.searchConsole).toMatchObject({ status: "observed", sampledClicks: 0, sampledImpressions: 0, clickThroughRate: null });
  });
});
