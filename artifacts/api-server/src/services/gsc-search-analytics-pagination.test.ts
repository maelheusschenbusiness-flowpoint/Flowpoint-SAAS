import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("./google-service.js", () => ({ getValidToken: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { fetchSearchAnalyticsRows } = await import("./gsc-service.js");

const row = (i: number) => ({ keys: [`k${i}`, "2026-11-01"], clicks: 0, impressions: 1, ctr: 0, position: 5 }) as never;

describe("fetchSearchAnalyticsRows", () => {
  it("pages past the first 5000 rows instead of truncating", async () => {
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const { startRow } = JSON.parse(init.body) as { startRow: number };
      starts.push(startRow);
      const n = startRow === 0 ? 5000 : 120;
      return { ok: true, json: async () => ({ rows: Array.from({ length: n }, (_, i) => row(startRow + i)) }) } as unknown as Response;
    }));
    const result = await fetchSearchAnalyticsRows("t", "sc-domain:x.com", "2026-10-01", "2026-11-01", "query");
    expect(result.ok && result.rows.length).toBe(5120);
    expect(starts).toEqual([0, 5000]);
  });

  it("reports an HTTP failure on the first page and keeps rows when a later page fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response));
    expect(await fetchSearchAnalyticsRows("t", "s", "a", "b", "page")).toEqual({ ok: false, status: 403 });
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      return call === 1
        ? ({ ok: true, json: async () => ({ rows: Array.from({ length: 5000 }, (_, i) => row(i)) }) } as unknown as Response)
        : ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response);
    }));
    const r = await fetchSearchAnalyticsRows("t", "s", "a", "b", "page");
    expect(r.ok && r.rows.length).toBe(5000);
  });
});
