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
});
