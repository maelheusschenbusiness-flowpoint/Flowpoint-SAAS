import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkQuotaMock } = vi.hoisted(() => ({ checkQuotaMock: vi.fn(async () => ({ allowed: true, used: 0, limit: 50 })) }));
vi.mock("./billing-service.js", () => ({
  checkQuota: checkQuotaMock,
}));

import {
  createAgencyCustomerPortal,
  createConsolidatedAgencyReport,
  getAgencyPublicBaseUrl,
  hashAgencyPortalToken,
} from "./agency-reporting.js";

const siteA = {
  id: "audit-a", url: "https://a.example", score: 91, speed: 84, issues: 3,
  status: "completed", created_at: "2026-11-01T10:00:00.000Z",
};
const siteB = {
  id: "audit-b", url: "https://b.example", score: 72, speed: 68, issues: 9,
  status: "completed", created_at: "2026-11-02T10:00:00.000Z",
};

describe("Agency Reporting Packs persisted behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("PUBLIC_URL", "https://agency.example.test");
    vi.stubEnv("AGENCY_REPORT_SCHEDULER_ENABLED", "true");
  });

  it("consolidates only selected organization audits and writes each site's measured facts", async () => {
    const insertValues: unknown[][] = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM audits")) {
          return { rows: [siteA, siteB].filter(audit => (values[1] as string[]).includes(audit.id)) };
        }
        if (sql.includes("INSERT INTO reports")) insertValues.push(values);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const database = {
      connect: vi.fn(async () => client),
    } as any;

    const report = await createConsolidatedAgencyReport("org-a", "Client A", ["audit-b", "audit-a"], "user-a", database);

    expect(report.auditCount).toBe(2);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("WHERE org_id=$1 AND id=ANY"), ["org-a", ["audit-b", "audit-a"]]);
    expect(insertValues).toHaveLength(1);
    const notes = JSON.parse(String(insertValues[0][5]));
    expect(notes.map((note: { site: string }) => note.site)).toEqual(["https://b.example", "https://a.example"]);
    expect(notes[0].notes).toContain("Score SEO mesuré : 72/100");
    expect(insertValues[0][6]).toContain("agency_multi_site");
    expect(insertValues[0][7]).toBe("user-a");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("rejects consolidation when any selected audit is not authorized by the org scope", async () => {
    const client = { query: vi.fn(async (sql: string) => sql.includes("FROM audits") ? { rows: [siteA] } : { rows: [] }), release: vi.fn() };
    const database = { connect: vi.fn(async () => client) } as any;
    await expect(createConsolidatedAgencyReport("org-a", "Client", ["audit-a", "foreign-audit"], "user-a", database))
      .rejects.toThrow("AGENCY_AUDIT_NOT_FOUND");
  });

  it("stores only a one-way hash for a high-entropy portal token and scopes its report grants", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const database = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        writes.push({ sql, values });
        if (sql.includes("SELECT id FROM reports")) return { rows: [{ id: "r-a" }, { id: "r-b" }] };
        return { rows: [] };
      }),
    } as any;
    const portal = await createAgencyCustomerPortal("org-a", "Client A", ["r-a", "r-b"], "user-a", database);
    const insert = writes.find(write => write.sql.includes("INSERT INTO agency_customer_portals"))!;

    expect(portal.token).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
    expect(portal.token).toHaveLength(43);
    expect(insert.values[2]).toBe(hashAgencyPortalToken(portal.token));
    expect(insert.values[2]).not.toBe(portal.token);
    expect(insert.values[4]).toBe(JSON.stringify(["r-a", "r-b"]));
    expect(insert.values[1]).toBe("org-a");
  });

  it("does not grant a portal to reports outside the tenant", async () => {
    const database = { query: vi.fn(async () => ({ rows: [{ id: "r-a" }] })) } as any;
    await expect(createAgencyCustomerPortal("org-a", "Client", ["r-a", "foreign-r"], "user-a", database))
      .rejects.toThrow("AGENCY_REPORT_NOT_FOUND");
  });

  it("fails before report quota or portal persistence when public base URL is absent", async () => {
    vi.stubEnv("PUBLIC_URL", "");
    vi.stubEnv("PUBLIC_BASE_URL", "");
    expect(() => getAgencyPublicBaseUrl()).toThrow("AGENCY_PUBLIC_URL_REQUIRED");

    const database = { connect: vi.fn(), query: vi.fn() } as any;
    await expect(createConsolidatedAgencyReport("org-a", "Client", ["audit-a", "audit-b"], "user-a", database))
      .rejects.toThrow("AGENCY_PUBLIC_URL_REQUIRED");
    await expect(createAgencyCustomerPortal("org-a", "Client", ["r-a"], "user-a", database))
      .rejects.toThrow("AGENCY_PUBLIC_URL_REQUIRED");
    expect(database.connect).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
    expect(checkQuotaMock).not.toHaveBeenCalled();
  });
});
