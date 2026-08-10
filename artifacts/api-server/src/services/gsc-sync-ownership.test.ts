/**
 * gsc-sync-ownership.test.ts — fail-closed sync for GSC active sites
 *
 * Certifies that syncGSCData never issues a Search Analytics request with the
 * org's Google token for an active site whose provenance is not verified
 * (legacy poisoned rows persisted before the activation ownership gate).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "22222222-2222-2222-2222-222222222222";
const VERIFIED_SITE = "sc-domain:good.com";
const POISONED_SITE = "sc-domain:poison.com";

// mutable fixture: the current active gsc_sites row
let activeRow: { site_url: string; permission_level: string | null } | null = null;
const quarantined: string[] = [];

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("WHERE org_id=$1 AND is_active=true")) {
        return { rows: activeRow ? [activeRow] : [] };
      }
      if (sql.includes("SELECT 1 FROM gsc_sites") || sql.includes("SELECT permission_level")) {
        return { rows: [] }; // no discovered-verified row for the poisoned site
      }
      if (sql.includes("UPDATE gsc_sites SET is_active=false")) {
        quarantined.push(String(params?.[1]));
        return { rows: [] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    })),
  },
}));
vi.mock("./google-service.js", () => ({
  getValidToken: vi.fn(async () => "fake-google-token"),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Track every outbound Google call
const fetchCalls: string[] = [];
vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
  const u = String(url);
  fetchCalls.push(u);
  if (u.endsWith("/sites") || /webmasters\/v3\/sites$/.test(u)) {
    // Google's site list for this token: only VERIFIED_SITE is accessible
    return {
      ok: true,
      json: async () => ({ siteEntry: [{ siteUrl: VERIFIED_SITE, permissionLevel: "siteOwner" }] }),
    } as unknown as Response;
  }
  if (u.includes("searchAnalytics/query")) {
    return { ok: true, json: async () => ({ rows: [] }) } as unknown as Response;
  }
  return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
}));

const { syncGSCData, getVerifiedActiveSite } = await import("./gsc-service.js");

beforeEach(() => { fetchCalls.length = 0; quarantined.length = 0; activeRow = null; });

describe("syncGSCData fail-closed ownership", () => {
  it("poisoned active site (NULL permission_level, token has no access): no Search Analytics call, quarantined", async () => {
    activeRow = { site_url: POISONED_SITE, permission_level: null };
    const inserted = await syncGSCData(ORG);
    expect(inserted).toBe(0);
    // The only outbound call allowed is the sites/list verification — never data
    expect(fetchCalls.some(u => u.includes("searchAnalytics/query"))).toBe(false);
    expect(fetchCalls.some(u => u.includes(encodeURIComponent(POISONED_SITE)))).toBe(false);
    expect(quarantined).toContain(POISONED_SITE);
  });

  it("verified-provenance active site syncs normally without a live verification call", async () => {
    activeRow = { site_url: VERIFIED_SITE, permission_level: "siteOwner" };
    await syncGSCData(ORG);
    expect(fetchCalls.some(u => u.includes("searchAnalytics/query"))).toBe(true);
    // provenance already verified → no extra sites/list call before the data query
    expect(fetchCalls[0]).toContain("searchAnalytics/query");
  });

  it("no active site: returns 0 with zero Google calls", async () => {
    activeRow = null;
    const inserted = await syncGSCData(ORG);
    expect(inserted).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("getVerifiedActiveSite", () => {
  it("returns null and quarantines an unverifiable active row", async () => {
    activeRow = { site_url: POISONED_SITE, permission_level: null };
    expect(await getVerifiedActiveSite(ORG)).toBeNull();
    expect(quarantined).toContain(POISONED_SITE);
  });

  it("live-verifies a NULL-permission row the token DOES own and returns it", async () => {
    activeRow = { site_url: VERIFIED_SITE, permission_level: null };
    expect(await getVerifiedActiveSite(ORG)).toBe(VERIFIED_SITE);
    expect(quarantined).toHaveLength(0);
  });

  it("returns a verified-provenance row without any Google call", async () => {
    activeRow = { site_url: VERIFIED_SITE, permission_level: "siteFullUser" };
    expect(await getVerifiedActiveSite(ORG)).toBe(VERIFIED_SITE);
    expect(fetchCalls).toHaveLength(0);
  });
});
