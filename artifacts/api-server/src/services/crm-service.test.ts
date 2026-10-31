import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectMock, queryMock, releaseMock, clientMock } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return {
    connectMock: vi.fn(async () => client),
    queryMock: query,
    releaseMock: release,
    clientMock: client,
  };
});

vi.mock("@workspace/db", () => ({
  pool: { connect: connectMock },
}));

import { getCrmStatus, syncCrm } from "./crm-service.js";

describe("CRM service readiness boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue(clientMock as never);
  });

  it("never returns stored provider tokens in status results", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: "crm-1",
          provider: "hubspot",
          name: "HubSpot",
          status: "connected",
          created_at: "2026-10-31T10:00:00.000Z",
          access_token: "secret-access-token",
          refresh_token: "secret-refresh-token",
          metadata: { token: "secret-metadata-token" },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ total_syncs: "0", total_records: null, total_created: null, total_failed: null, avg_duration_ms: null }],
      });

    const result = await getCrmStatus("org-a");

    expect(result.connected).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret-access-token");
    expect(JSON.stringify(result)).not.toContain("secret-refresh-token");
    expect(JSON.stringify(result)).not.toContain("secret-metadata-token");
    expect(result.integrations[0]).toEqual({
      id: "crm-1",
      provider: "hubspot",
      name: "HubSpot",
      status: "connected",
      created_at: "2026-10-31T10:00:00.000Z",
    });
    expect(queryMock.mock.calls[0]?.[0]).not.toContain("SELECT *");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("fails explicitly instead of logging an empty successful sync", async () => {
    await expect(syncCrm("org-a", "hubspot")).rejects.toMatchObject({
      code: "CRM_SYNC_UNAVAILABLE",
    });
    expect(connectMock).not.toHaveBeenCalled();
  });
});
