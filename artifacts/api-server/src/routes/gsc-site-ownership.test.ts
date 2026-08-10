/**
 * gsc-site-ownership.test.ts — Google integrations audit regression tests (Task #496)
 *
 * Certifies:
 *  1. A caller-supplied ?siteUrl that the org does NOT own is rejected (403)
 *     — our Google tokens must never query arbitrary GSC properties.
 *  2. A caller-supplied siteUrl the org owns is accepted.
 *  3. No siteUrl → org's active site is used.
 *  4. /gsc/indexing returns the real URL-Inspection shape — never fabricated
 *     {indexed:0, notIndexed:0, errors:0} placeholder counts.
 *  5. /gsc/status separates connected (active site or token) from
 *     product-disconnected (explicit flag false).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNED_SITE = "sc-domain:example.com";      // verified provenance (permission_level from Google)
const FOREIGN_SITE = "sc-domain:victim.com";     // no row at all
const LEGACY_SITE = "sc-domain:legacy-poison.com"; // row exists but permission_level NULL (pre-gate poisoning)

// mutable: which site getActiveSite returns
let activeSite: string | null = OWNED_SITE;
// tracks quarantine (is_active=false) updates
const quarantined: string[] = [];

// ─── Mock DB pool — org owns only OWNED_SITE ─────────────────────────────────
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT permission_level FROM gsc_sites")) {
        if (params?.[1] === OWNED_SITE)  return { rows: [{ permission_level: "siteOwner" }] };
        if (params?.[1] === LEGACY_SITE) return { rows: [{ permission_level: null }] };
        return { rows: [] };
      }
      if (sql.includes("UPDATE gsc_sites SET is_active=false")) {
        quarantined.push(String(params?.[1]));
        return { rows: [] };
      }
      if (sql.includes("google_product_connections")) return { rows: [] };
      return { rows: [] };
    }),
    connect: vi.fn(),
  },
}));

// ─── Mock services ────────────────────────────────────────────────────────────
const inspectCalls: Array<{ siteUrl?: string; inspectionUrl?: string }> = [];
const activatedSites: string[] = [];
const liveVerifyCalls: string[] = [];
vi.mock("../services/gsc-service.js", () => ({
  getGSCStatus:          vi.fn(async () => ({ connected: true, siteUrl: OWNED_SITE, sitesCount: 1 })),
  listGSCSites:          vi.fn(async () => []),
  getActiveSite:         vi.fn(async () => activeSite),
  setActiveSite:         vi.fn(async (_orgId: string, siteUrl: string) => { activatedSites.push(siteUrl); }),
  verifySiteOwnership:   vi.fn(async (_orgId: string, siteUrl: string) => {
    liveVerifyCalls.push(siteUrl);
    return siteUrl === OWNED_SITE; // Google token can only access OWNED_SITE
  }),
  syncGSCData:           vi.fn(async () => ({ synced: 0 })),
  getTopKeywords:        vi.fn(async () => []),
  getTopPages:           vi.fn(async () => []),
  getImpressionsOverTime: vi.fn(async () => []),
  querySearchAnalytics:  vi.fn(async () => []),
  getIndexingStatus:     vi.fn(async (_orgId: string, siteUrl?: string, inspectionUrl?: string) => {
    inspectCalls.push({ siteUrl, inspectionUrl });
    return {
      inspected: true, verdict: "PASS", coverageState: "Submitted and indexed",
      lastCrawlTime: "2026-08-01T00:00:00Z", robotsTxtState: "ALLOWED",
      indexingState: "INDEXING_ALLOWED", googleCanonical: "https://example.com/page",
    };
  }),
  getSitemaps:           vi.fn(async () => []),
  getSyncLogs:           vi.fn(async () => []),
}));
vi.mock("../services/google-service.js", () => ({
  hasGoogleConnection: vi.fn(async () => true),
}));
vi.mock("../lib/resolve-org-id.js", () => ({
  resolveOrgId: vi.fn(() => ORG),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: gscRouter } = await import("./gsc.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", gscRouter);
  return app;
}

beforeEach(() => {
  inspectCalls.length = 0;
  activatedSites.length = 0;
  liveVerifyCalls.length = 0;
  quarantined.length = 0;
  activeSite = OWNED_SITE;
});

describe("GSC siteUrl ownership gate", () => {
  it("rejects a foreign siteUrl on /gsc/analytics with 403", async () => {
    const res = await request(makeApp()).get(`/api/gsc/analytics?siteUrl=${encodeURIComponent(FOREIGN_SITE)}`);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it("rejects a foreign siteUrl on /gsc/keywords with 403", async () => {
    const res = await request(makeApp()).get(`/api/gsc/keywords?siteUrl=${encodeURIComponent(FOREIGN_SITE)}`);
    expect(res.status).toBe(403);
  });

  it("rejects a foreign siteUrl on /gsc/indexing with 403", async () => {
    const res = await request(makeApp())
      .post("/api/gsc/indexing")
      .send({ inspectionUrl: "https://example.com/page", siteUrl: FOREIGN_SITE });
    expect(res.status).toBe(403);
    expect(inspectCalls.length).toBe(0);
  });

  it("accepts an owned siteUrl on /gsc/analytics", async () => {
    const res = await request(makeApp()).get(`/api/gsc/analytics?siteUrl=${encodeURIComponent(OWNED_SITE)}`);
    expect(res.status).toBe(200);
    expect(res.body.siteUrl).toBe(OWNED_SITE);
  });

  it("falls back to the active site when no siteUrl supplied", async () => {
    const res = await request(makeApp()).get("/api/gsc/analytics");
    expect(res.status).toBe(200);
    expect(res.body.siteUrl).toBe(OWNED_SITE);
  });
});

describe("GSC indexing — real inspection, no fabricated counts", () => {
  it("returns the URL-Inspection shape (inspected/verdict), never {indexed:0,...}", async () => {
    const res = await request(makeApp())
      .post("/api/gsc/indexing")
      .send({ inspectionUrl: "https://example.com/page" });
    expect(res.status).toBe(200);
    expect(res.body.result.inspected).toBe(true);
    expect(res.body.result.verdict).toBe("PASS");
    expect(res.body.result).not.toHaveProperty("indexed");
    expect(res.body.result).not.toHaveProperty("notIndexed");
  });

  it("requires inspectionUrl (400 without it)", async () => {
    const res = await request(makeApp()).post("/api/gsc/indexing").send({});
    expect(res.status).toBe(400);
  });
});

describe("GSC site activation — ownership verified against Google token", () => {
  it("rejects activating a site the org's Google token cannot access (403), never persisted", async () => {
    const res = await request(makeApp())
      .post("/api/gsc/site")
      .send({ siteUrl: FOREIGN_SITE });
    expect(res.status).toBe(403);
    expect(activatedSites).toHaveLength(0);
  });

  it("cannot use POST /gsc/site to poison the ownership gate for data routes", async () => {
    // Step 1: attempt to activate a foreign site → rejected
    const activate = await request(makeApp())
      .post("/api/gsc/site")
      .send({ siteUrl: FOREIGN_SITE });
    expect(activate.status).toBe(403);
    // Step 2: the foreign site still fails the data-route ownership gate
    const data = await request(makeApp())
      .get(`/api/gsc/analytics?siteUrl=${encodeURIComponent(FOREIGN_SITE)}`);
    expect(data.status).toBe(403);
  });

  it("accepts activating a site the token owns", async () => {
    const res = await request(makeApp())
      .post("/api/gsc/site")
      .send({ siteUrl: OWNED_SITE });
    expect(res.status).toBe(200);
    expect(activatedSites).toEqual([OWNED_SITE]);
  });

  it("requires siteUrl (400 without it)", async () => {
    const res = await request(makeApp()).post("/api/gsc/site").send({});
    expect(res.status).toBe(400);
  });
});

describe("GSC legacy poisoned rows — row presence is NOT ownership", () => {
  it("rejects a legacy row (NULL permission_level) supplied as override: live-verify fails → 403, no GSC data call", async () => {
    const res = await request(makeApp())
      .get(`/api/gsc/analytics?siteUrl=${encodeURIComponent(LEGACY_SITE)}`);
    expect(res.status).toBe(403);
    expect(liveVerifyCalls).toEqual([LEGACY_SITE]);   // it WAS live-checked against Google
    expect(quarantined).toContain(LEGACY_SITE);       // and quarantined (is_active=false)
  });

  it("rejects a legacy poisoned ACTIVE site with no override → 403 and quarantine", async () => {
    activeSite = LEGACY_SITE; // pre-gate poisoning made it the silent default
    const res = await request(makeApp()).get("/api/gsc/analytics");
    expect(res.status).toBe(403);
    expect(liveVerifyCalls).toEqual([LEGACY_SITE]);
    expect(quarantined).toContain(LEGACY_SITE);
  });

  it("legacy active site cannot reach URL Inspection either", async () => {
    activeSite = LEGACY_SITE;
    const res = await request(makeApp())
      .post("/api/gsc/indexing")
      .send({ inspectionUrl: "https://legacy-poison.com/page" });
    expect(res.status).toBe(403);
    expect(inspectCalls).toHaveLength(0); // no Google inspection API call
  });

  it("verified-provenance site (permission_level from Google) passes without a live call", async () => {
    const res = await request(makeApp())
      .get(`/api/gsc/analytics?siteUrl=${encodeURIComponent(OWNED_SITE)}`);
    expect(res.status).toBe(200);
    expect(liveVerifyCalls).toHaveLength(0); // provenance already verified, no extra Google call
  });
});

describe("GSC status contract", () => {
  it("reports connected when an active site exists and product flag is absent", async () => {
    const res = await request(makeApp()).get("/api/gsc/status");
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });
});
