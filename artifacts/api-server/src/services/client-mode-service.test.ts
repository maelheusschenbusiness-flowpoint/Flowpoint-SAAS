/**
 * client-mode-service.test.ts — reliability contract
 *
 * Proves the Agency-Lab / client-mode data service no longer swallows SQL or
 * schema failures as legitimate empty results:
 *   - genuine empty result (0 rows)      → resolves to [] (preserved)
 *   - real SQL error (e.g. deadlock)     → THROWS (route → 500 → frontend retry)
 *   - schema drift (missing table 42P01) → self-heals once via initDataTables,
 *                                           retries, and only then resolves
 *   - self-heal that still fails         → THROWS (never a silent [])
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock pool + logger + init-data-tables ───────────────────────────────────
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(async () => ({ query: mockQuery, release: mockRelease }));

vi.mock("@workspace/db", () => ({
  pool: { connect: () => mockConnect() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockInitDataTables = vi.fn(async () => {});
vi.mock("./init-data-tables.js", () => ({
  initDataTables: () => mockInitDataTables(),
}));

import {
  getClientReports,
  getClientAudits,
  getClientKPIs,
  getClientStatus,
} from "./client-mode-service.js";

function pgErr(code: string): Error & { code: string } {
  const e = new Error(`pg error ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
  mockInitDataTables.mockClear();
});

describe("getClientReports — reliability", () => {
  it("preserves a genuine empty state (0 rows → [])", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getClientReports("org-1")).resolves.toEqual([]);
    expect(mockInitDataTables).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("throws on a real (non-schema) SQL error instead of returning []", async () => {
    mockQuery.mockRejectedValueOnce(pgErr("40P01")); // deadlock_detected
    await expect(getClientReports("org-1")).rejects.toMatchObject({ code: "40P01" });
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("self-heals once and retries on missing table (42P01)", async () => {
    mockQuery
      .mockRejectedValueOnce(pgErr("42P01"))
      .mockResolvedValueOnce({ rows: [{ id: "r1", name: "R", type: "PDF", date: null, pages: 3, token: "t" }] });
    const out = await getClientReports("org-1");
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "r1", token: "t", pages: 3 });
  });

  it("throws if the query still fails after self-heal", async () => {
    mockQuery
      .mockRejectedValueOnce(pgErr("42P01"))
      .mockRejectedValueOnce(pgErr("42P01"));
    await expect(getClientReports("org-1")).rejects.toMatchObject({ code: "42P01" });
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
  });
});

/**
 * The reports → share_tokens join yields one row per share link. Each report
 * must be returned exactly once, with its freshest non-expired link; a report
 * with no link at all, or whose every link has expired, is not returned (its
 * public page would answer 404/410).
 */
describe("getClientReports — grouping by report, freshest live link", () => {
  const NOW = new Date("2026-03-01T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** One joined row: a report line duplicated per share link. */
  function joinRow(opts: {
    id: string;
    token: string | null;
    createdAt?: string | null;
    expiresAt?: string | null;
    name?: string;
  }) {
    return {
      id: opts.id,
      name: opts.name ?? `Rapport ${opts.id}`,
      type: "PDF",
      date: "2026-02-10T00:00:00.000Z",
      pages: 4,
      token: opts.token,
      link_created_at: opts.createdAt ?? null,
      link_expires_at: opts.expiresAt ?? null,
    };
  }

  it("returns a twice-shared report once, with the most recent link", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r1", token: "old", createdAt: "2026-01-05T09:00:00.000Z", expiresAt: "2026-04-01T00:00:00.000Z" }),
        joinRow({ id: "r1", token: "fresh", createdAt: "2026-02-20T09:00:00.000Z", expiresAt: "2026-04-01T00:00:00.000Z" }),
      ],
    });

    const out = await getClientReports("org-1");

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "r1", token: "fresh", pages: 4 });
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("keeps the most recent link whatever the row order", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r1", token: "fresh", createdAt: "2026-02-20T09:00:00.000Z" }),
        joinRow({ id: "r1", token: "old", createdAt: "2026-01-05T09:00:00.000Z" }),
      ],
    });

    const out = await getClientReports("org-1");

    expect(out).toHaveLength(1);
    expect(out[0]?.token).toBe("fresh");
  });

  it("drops a report with no share link (never shared / all links revoked)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r1", token: null }),
        joinRow({ id: "r2", token: "t2", createdAt: "2026-02-01T09:00:00.000Z" }),
      ],
    });

    const out = await getClientReports("org-1");

    expect(out.map((r) => r.id)).toEqual(["r2"]);
  });

  it("drops a report whose every link has expired", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r1", token: "dead-1", createdAt: "2026-01-01T09:00:00.000Z", expiresAt: "2026-01-15T00:00:00.000Z" }),
        joinRow({ id: "r1", token: "dead-2", createdAt: "2026-02-01T09:00:00.000Z", expiresAt: "2026-02-28T00:00:00.000Z" }),
      ],
    });

    await expect(getClientReports("org-1")).resolves.toEqual([]);
  });

  it("keeps the live link when an expired link is more recent", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r1", token: "alive", createdAt: "2026-01-10T09:00:00.000Z", expiresAt: "2026-06-01T00:00:00.000Z" }),
        joinRow({ id: "r1", token: "expired", createdAt: "2026-02-25T09:00:00.000Z", expiresAt: "2026-02-26T00:00:00.000Z" }),
      ],
    });

    const out = await getClientReports("org-1");

    expect(out).toHaveLength(1);
    expect(out[0]?.token).toBe("alive");
  });

  it("treats a missing or unreadable expiry as 'no expiry'", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r1", token: "no-expiry", createdAt: "2026-02-01T09:00:00.000Z", expiresAt: null }),
        joinRow({ id: "r2", token: "bad-expiry", createdAt: "2026-02-01T09:00:00.000Z", expiresAt: "not-a-date" }),
      ],
    });

    const out = await getClientReports("org-1");

    expect(out.map((r) => r.token)).toEqual(["no-expiry", "bad-expiry"]);
  });

  it("accepts a Date instance for the link timestamps", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { ...joinRow({ id: "r1", token: "old" }), link_created_at: new Date("2026-01-01T00:00:00.000Z"), link_expires_at: new Date("2026-05-01T00:00:00.000Z") },
        { ...joinRow({ id: "r1", token: "recent" }), link_created_at: new Date("2026-02-01T00:00:00.000Z"), link_expires_at: new Date("2026-05-01T00:00:00.000Z") },
      ],
    });

    const out = await getClientReports("org-1");

    expect(out).toHaveLength(1);
    expect(out[0]?.token).toBe("recent");
  });

  it("keeps the report order of the rows returned by the database", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        joinRow({ id: "r3", token: "t3a", createdAt: "2026-02-25T09:00:00.000Z" }),
        joinRow({ id: "r2", token: "t2", createdAt: "2026-02-20T09:00:00.000Z" }),
        joinRow({ id: "r3", token: "t3b", createdAt: "2026-02-26T09:00:00.000Z" }),
        joinRow({ id: "r1", token: "t1", createdAt: "2026-02-10T09:00:00.000Z" }),
      ],
    });

    const out = await getClientReports("org-1");

    expect(out.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    expect(out.map((r) => r.token)).toEqual(["t3b", "t2", "t1"]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("getClientAudits — reliability", () => {
  it("preserves a genuine empty state", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getClientAudits("org-1")).resolves.toEqual([]);
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("throws on a real SQL error", async () => {
    mockQuery.mockRejectedValueOnce(pgErr("08006")); // connection failure
    await expect(getClientAudits("org-1")).rejects.toMatchObject({ code: "08006" });
  });

  it("self-heals once and retries on missing column (42703)", async () => {
    mockQuery
      .mockRejectedValueOnce(pgErr("42703"))
      .mockResolvedValueOnce({ rows: [{ id: "a1", url: "https://x", score: 90, status: "done", created_at: null }] });
    const out = await getClientAudits("org-1");
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
    expect(out[0]).toMatchObject({ id: "a1", score: 90 });
  });
});

describe("getClientKPIs — reliability", () => {
  it("throws when a core KPI query fails (no partial/zeroed payload)", async () => {
    mockQuery.mockRejectedValueOnce(pgErr("42P01")); // first (audits) query fails
    await expect(getClientKPIs("org-1")).rejects.toMatchObject({ code: "42P01" });
  });

  it("tolerates a missing gbp_profiles table (optional) → gbp_rating null", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ c: 2, avg: 88 }] })              // audits
      .mockResolvedValueOnce({ rows: [{ total: 1, up: 1, down: 0, avg_up: 99.5 }] }) // monitors
      .mockResolvedValueOnce({ rows: [{ shared: 3 }] })                  // reports
      .mockResolvedValueOnce({ rows: [{ total: 5, done: 2 }] })          // missions
      .mockRejectedValueOnce(pgErr("42P01"));                            // gbp_profiles missing
    const kpis = await getClientKPIs("org-1");
    expect(kpis.gbp_rating).toBeNull();
    expect(kpis.avg_seo_score).toBe(88);
    expect(kpis.reports_shared).toBe(3);
  });

  it("throws when gbp_profiles query fails with a NON-schema error", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ c: 0, avg: null }] })
      .mockResolvedValueOnce({ rows: [{ total: 0, up: 0, down: 0, avg_up: null }] })
      .mockResolvedValueOnce({ rows: [{ shared: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total: 0, done: 0 }] })
      .mockRejectedValueOnce(pgErr("40001")); // serialization_failure — real error
    await expect(getClientKPIs("org-1")).rejects.toMatchObject({ code: "40001" });
  });
});

describe("getClientStatus — reliability", () => {
  it("throws on a real SQL error instead of reporting no plan/no sites", async () => {
    mockQuery.mockRejectedValueOnce(pgErr("08006"));
    await expect(getClientStatus("org-1")).rejects.toMatchObject({ code: "08006" });
  });

  it("returns a stable status on success", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ plan: "pro" }] })
      .mockResolvedValueOnce({ rows: [{ c: 4 }] });
    const s = await getClientStatus("org-1");
    expect(s).toMatchObject({ org_id: "org-1", plan: "pro", site_count: 4, client_mode_enabled: true });
  });
});
