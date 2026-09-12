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

import { describe, it, expect, vi, beforeEach } from "vitest";

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
