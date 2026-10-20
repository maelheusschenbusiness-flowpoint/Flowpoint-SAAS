/**
 * ga4-connection-status.test.ts
 *
 * Regression tests for the GA4 connection-state contract:
 *
 *   - getGA4ConnectionStatus(): `connected` = tokens or active property
 *     (unless per-product disconnect), `discovering` = tokens without an
 *     active property.
 *   - isGA4Connected(): "ready to query" gate — MUST require an active
 *     property. Tokens-only OAuth (property discovery still running) must
 *     NOT count as connected, otherwise every GA4 data surface (traffic,
 *     audience, campaigns, live, conversion) reports connected while
 *     getGA4Context has no property and returns empty datasets.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const poolQuery = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn() },
  db: {},
  withOrgDb: vi.fn(),
}));
vi.mock("./google-service.js", () => ({
  getValidToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getGA4ConnectionStatus, isGA4Connected } from "./ga4-service.js";

/**
 * Configure the three parallel queries issued by getGA4ConnectionStatus:
 * ga4_properties (active property), google_tokens, google_product_connections.
 */
function mockDbState(opts: { hasProperty: boolean; hasTokens: boolean; productConnected?: boolean | null }) {
  poolQuery.mockImplementation((sql: string) => {
    const q = String(sql);
    if (q.includes("ga4_properties")) {
      return Promise.resolve({ rows: opts.hasProperty ? [{ "?column?": 1 }] : [] });
    }
    if (q.includes("google_tokens")) {
      return Promise.resolve({ rows: opts.hasTokens ? [{ "?column?": 1 }] : [] });
    }
    if (q.includes("google_product_connections")) {
      return Promise.resolve({
        rows: opts.productConnected === null || opts.productConnected === undefined
          ? []
          : [{ connected: opts.productConnected }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { poolQuery.mockReset(); });

describe("getGA4ConnectionStatus", () => {
  it("active property → connected, not discovering", async () => {
    mockDbState({ hasProperty: true, hasTokens: true });
    expect(await getGA4ConnectionStatus("org1")).toEqual({ connected: true, discovering: false });
  });

  it("tokens only (discovery in progress) → connected AND discovering", async () => {
    mockDbState({ hasProperty: false, hasTokens: true });
    expect(await getGA4ConnectionStatus("org1")).toEqual({ connected: true, discovering: true });
  });

  it("nothing stored → disconnected", async () => {
    mockDbState({ hasProperty: false, hasTokens: false });
    expect(await getGA4ConnectionStatus("org1")).toEqual({ connected: false, discovering: false });
  });

  it("explicit per-product disconnect wins even with property + tokens", async () => {
    mockDbState({ hasProperty: true, hasTokens: true, productConnected: false });
    expect(await getGA4ConnectionStatus("org1")).toEqual({ connected: false, discovering: false });
  });

  it("DB errors degrade to disconnected, never throw", async () => {
    poolQuery.mockRejectedValue(new Error("db down"));
    expect(await getGA4ConnectionStatus("org1")).toEqual({ connected: false, discovering: false });
  });
});

describe("isGA4Connected — ready-to-query gate", () => {
  it("true only with an active property", async () => {
    mockDbState({ hasProperty: true, hasTokens: true });
    expect(await isGA4Connected("org1")).toBe(true);
  });

  it("REGRESSION: tokens-only must be false — discovery is not queryable", async () => {
    mockDbState({ hasProperty: false, hasTokens: true });
    expect(await isGA4Connected("org1")).toBe(false);
  });

  it("false when fully disconnected", async () => {
    mockDbState({ hasProperty: false, hasTokens: false });
    expect(await isGA4Connected("org1")).toBe(false);
  });

  it("false when the product was explicitly disconnected", async () => {
    mockDbState({ hasProperty: true, hasTokens: true, productConnected: false });
    expect(await isGA4Connected("org1")).toBe(false);
  });
});
