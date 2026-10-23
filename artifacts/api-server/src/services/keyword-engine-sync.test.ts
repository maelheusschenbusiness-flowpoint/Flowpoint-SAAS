import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  isConfigured: vi.fn(),
  checkQuota: vi.fn(),
  dfsRequest: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: mocks.connect },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./dataforseo-service.js", () => ({
  isDataForSEOConfigured: mocks.isConfigured,
  checkAndIncrementQuota: mocks.checkQuota,
  dfsRequest: mocks.dfsRequest,
}));
vi.mock("./ai-prefs.js", () => ({
  loadOrgAIPrefs: vi.fn(),
  resolveAIModel: vi.fn(),
}));
vi.mock("./ai-provider.js", () => ({
  aiChat: vi.fn(),
}));

import { syncOrgRankings } from "./keyword-engine.js";

const ORG_ID = "00000000-0000-4000-8000-0000000000a1";

describe("syncOrgRankings tenant scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockResolvedValue(true);
    mocks.checkQuota.mockResolvedValue(true);
    mocks.dfsRequest.mockResolvedValue([{
      status_code: 20000,
      result: [{ items: [{ type: "organic", rank_absolute: 4, domain: "owned.example" }] }],
    }]);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT website FROM org_settings")) {
        return { rows: [{ website: "https://owned.example" }] };
      }
      if (sql.includes("FROM tracked_keywords") && sql.includes("ORDER BY COALESCE(last_sync_at")) {
        return {
          rows: [{
            id: "keyword-owned",
            keyword: "owned keyword",
            location: "Belgium",
            device: "desktop",
            url: "https://owned.example/page",
          }],
        };
      }
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  });

  it("scopes position updates and history volume lookup to the requesting organization", async () => {
    const result = await syncOrgRankings(ORG_ID);

    expect(result).toEqual({ configured: true, synced: 1 });
    const update = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE tracked_keywords SET"),
    );
    expect(update?.[0]).toContain("WHERE id = $2 AND org_id = $3");
    expect(update?.[1]).toEqual([4, "keyword-owned", ORG_ID]);

    const history = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO keyword_history"),
    );
    expect(history?.[0]).toContain("WHERE id=$2 AND org_id=$1");
    expect(history?.[1]).toEqual([ORG_ID, "keyword-owned", 4]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
