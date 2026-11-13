import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectMock, queryMock, releaseMock, fireAlertEventMock, broadcastMock, sendSeoAlertMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  fireAlertEventMock: vi.fn(),
  broadcastMock: vi.fn(),
  sendSeoAlertMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({ pool: { connect: connectMock } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock("./mailer.js", () => ({ mailer: { sendSeoAlert: sendSeoAlertMock } }));
vi.mock("./store.js", () => ({ store: { broadcast: broadcastMock } }));
vi.mock("./alert-events-service.js", () => ({
  evaluateCondition: (value: number, operator: string, threshold: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
    return operator === "lt" ? value < threshold
      : operator === "lte" ? value <= threshold
      : operator === "gt" ? value > threshold
      : operator === "gte" ? value >= threshold
      : operator === "eq" ? value === threshold
      : false;
  },
  fireAlertEvent: fireAlertEventMock,
}));

import { evaluateAlertRulesForAudit } from "./monitor-cron.js";

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-org-a",
    org_id: "org-a",
    name: "Score SEO critique",
    operator: "lt",
    threshold: 50,
    channels: [],
    site_urls: ["https://example.test"],
    org_email: null,
    ...overrides,
  };
}

describe("SEO alert evaluation from persisted audits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT ar.*")) return { rows: [rule()] };
      return { rows: [] };
    });
    connectMock.mockResolvedValue({ query: queryMock, release: releaseMock });
  });

  it("fires a persisted alert for a below-threshold audit on the configured site", async () => {
    await evaluateAlertRulesForAudit("https://example.test", 42, "org-a");

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("ar.org_id = $1"), ["org-a"]);
    expect(fireAlertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-a",
      ruleId: "rule-org-a",
      type: "seo_score",
      metricValue: 42,
      threshold: 50,
      operator: "lt",
      siteUrl: "https://example.test",
    }));
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notifications"), expect.arrayContaining(["org-a"]));
    expect(broadcastMock).toHaveBeenCalledWith(expect.objectContaining({ type: "alert:update" }), "org-a");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("does not fire when the audit is healthy or belongs to another configured site", async () => {
    await evaluateAlertRulesForAudit("https://example.test", 82, "org-a");
    expect(fireAlertEventMock).not.toHaveBeenCalled();

    queryMock.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT ar.*") ? { rows: [rule({ site_urls: ["https://other.test"] })] } : { rows: [] },
    );
    await evaluateAlertRulesForAudit("https://example.test", 42, "org-a");
    expect(fireAlertEventMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notifications"), expect.anything());
  });

  it("refuses to query or evaluate without an organization", async () => {
    await evaluateAlertRulesForAudit("https://example.test", 42, "");
    expect(connectMock).not.toHaveBeenCalled();
    expect(fireAlertEventMock).not.toHaveBeenCalled();
  });
});
