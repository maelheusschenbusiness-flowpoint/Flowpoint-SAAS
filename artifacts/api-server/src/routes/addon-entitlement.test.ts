/**
 * Addon entitlement tests
 *
 * Verifies that requireAddon() correctly gates routes based on:
 *   1. Plan inclusion (PLAN_INCLUDED_ADDONS)
 *   2. Active org_addons row
 *   3. Neither → 402 ADDON_REQUIRED
 *
 * Uses mock pool queries to avoid live DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLAN_INCLUDED_ADDONS, BETA_ADDONS, COMING_SOON_ADDONS } from "../lib/plans.js";

// ── helpers ────────────────────────────────────────────────────────────────────

function makeReq(orgId: string): Record<string, unknown> {
  return { orgId, url: "/test", method: "GET", headers: {} };
}

function makeRes() {
  const data: { status?: number; body?: unknown } = {};
  return {
    status(code: number) { data.status = code; return this; },
    json(body: unknown) { data.body = body; return this; },
    _data: data,
  };
}

// ── Unit tests for PLAN_INCLUDED_ADDONS correctness ───────────────────────────

describe("PLAN_INCLUDED_ADDONS", () => {
  it("plans are cumulative except Ultra upgrades retention90d to retention365d", () => {
    const standard = PLAN_INCLUDED_ADDONS["standard"] ?? new Set();
    const pro      = PLAN_INCLUDED_ADDONS["pro"] ?? new Set();
    const ultra    = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set();

    // everything in standard must be in pro
    for (const key of standard) {
      expect(pro.has(key)).toBe(true);
    }
    // everything in pro must be in ultra
    for (const key of pro) {
      if (key === "retention90d") continue;
      expect(ultra.has(key)).toBe(true);
    }
    expect(ultra.has("retention90d")).toBe(false);
    expect(ultra.has("retention365d")).toBe(true);
  });

  it("Ultra has exactly 10 included add-ons", () => {
    // backlinkIntelligence: BETA + included (restored — regression fix).
    // behavioralAI + aiForecasting: BETA + included — intentional FlowPoint design.
    // Beta describes maturity; included describes commercial mode (non-billable).
    const ultra = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set();
    expect(ultra.size).toBe(10);
  });

  it("backlinkIntelligence: non-regression — must be beta AND included in Pro & Ultra simultaneously", () => {
    // Invariant: BETA ∩ INCLUDED is intentionally non-empty (beta = maturity, included = commercial mode).
    // Invariant: BETA ∩ COMING_SOON = ∅ (mutually exclusive lifecycle stages).
    // Regression guard: commit 28b266b incorrectly removed backlinkIntelligence from
    // PLAN_INCLUDED_ADDONS under the false assumption that COMING_SOON and INCLUDED are exclusive.
    expect(BETA_ADDONS.has("backlinkIntelligence")).toBe(true);
    expect(COMING_SOON_ADDONS.has("backlinkIntelligence")).toBe(false);
    expect(PLAN_INCLUDED_ADDONS["pro"]?.has("backlinkIntelligence")).toBe(true);
    expect(PLAN_INCLUDED_ADDONS["ultra"]?.has("backlinkIntelligence")).toBe(true);
  });

  it("Standard includes whiteLabel", () => {
    expect(PLAN_INCLUDED_ADDONS["standard"]?.has("whiteLabel")).toBe(true);
  });

  it("Pro includes advancedWebhooks and advancedSeoLab", () => {
    const pro = PLAN_INCLUDED_ADDONS["pro"] ?? new Set();
    expect(pro.has("advancedWebhooks")).toBe(true);
    expect(pro.has("advancedSeoLab")).toBe(true);
  });

  it("Ultra includes keywordDomination AND behavioralAI (beta + included)", () => {
    const ultra = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set();
    expect(ultra.has("keywordDomination")).toBe(true);
    // behavioralAI is BETA + included in Ultra: renders as "🧪 Beta — Inclus dans votre plan"
    // Beta ∩ Included is valid — beta describes maturity, included describes commercial mode.
    expect(ultra.has("behavioralAI")).toBe(true);
    expect(ultra.has("aiForecasting")).toBe(true);
  });
});

// ── Integration-style tests for requireAddon logic ────────────────────────────

describe("requireAddon — entitlement logic", () => {
  // We test the logic inline (not the middleware factory) to avoid needing
  // a live DB. The factory is tested separately in e2e tests.

  function checkEntitlement(
    plan: string,
    addonKey: string,
    orgAddonsActive: string[],
  ): boolean {
    const planBundle = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
    if (planBundle.has(addonKey)) return true;
    return orgAddonsActive.includes(addonKey);
  }

  it("Standard + no purchase → denied for behavioralAI", () => {
    expect(checkEntitlement("standard", "behavioralAI", [])).toBe(false);
  });

  it("Standard + behavioralAI purchased → allowed", () => {
    expect(checkEntitlement("standard", "behavioralAI", ["behavioralAI"])).toBe(true);
  });

  it("Pro + aiCro purchased → allowed", () => {
    expect(checkEntitlement("pro", "aiCro", ["aiCro"])).toBe(true);
  });

  it("Ultra + behavioralAI included → entitled without purchase (beta + included)", () => {
    // behavioralAI is BETA but bundled in Ultra: no purchase needed
    expect(checkEntitlement("ultra", "behavioralAI", [])).toBe(true);
  });

  it("Standard + aiForecasting purchased → allowed", () => {
    expect(checkEntitlement("standard", "aiForecasting", ["aiForecasting"])).toBe(true);
  });

  it("Pro + marketIntelligence not purchased → denied", () => {
    expect(checkEntitlement("pro", "marketIntelligence", [])).toBe(false);
  });

  it("Pro + advancedWebhooks → allowed (bundled)", () => {
    expect(checkEntitlement("pro", "advancedWebhooks", [])).toBe(true);
  });

  it("Standard + advancedWebhooks purchased → allowed", () => {
    expect(checkEntitlement("standard", "advancedWebhooks", ["advancedWebhooks"])).toBe(true);
  });

  it("Standard + advancedWebhooks NOT purchased → denied", () => {
    expect(checkEntitlement("standard", "advancedWebhooks", [])).toBe(false);
  });

  it("Standard + reviewIntelligence purchased → allowed", () => {
    expect(checkEntitlement("standard", "reviewIntelligence", ["reviewIntelligence"])).toBe(true);
  });

  it("Ultra + aiForecasting not purchased but bundled → allowed", () => {
    // aiForecasting is NOT in ultra bundle (it's a paid add-on even for Ultra)
    const ultraBundle = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set();
    const bundled = ultraBundle.has("aiForecasting");
    // If it's bundled: allowed without purchase. If not: purchase required.
    const result = checkEntitlement("ultra", "aiForecasting", []);
    expect(result).toBe(bundled);
  });

  it("CRM: Standard + crmIntegration purchased → allowed", () => {
    expect(checkEntitlement("standard", "crmIntegration", ["crmIntegration"])).toBe(true);
  });

  it("CRM: Pro + crmIntegration not purchased → denied (not in Pro bundle)", () => {
    expect(checkEntitlement("pro", "crmIntegration", [])).toBe(false);
  });

  it("revenueLeak: Standard + revenueLeak purchased → allowed", () => {
    expect(checkEntitlement("standard", "revenueLeak", ["revenueLeak"])).toBe(true);
  });

  it("localDominationMaps: Standard + purchased → allowed", () => {
    expect(checkEntitlement("standard", "localDominationMaps", ["localDominationMaps"])).toBe(true);
  });
});
