/**
 * plans.test.ts — integrity checks for PLAN_INCLUDED_ADDONS and entitlement consistency.
 *
 * These tests enforce the "single source of truth" invariant:
 *   1. Every key in any plan's included set must have a Stripe price ID.
 *   2. Every key in any plan's included set must be defined in ADDON_DEFINITIONS.
 *   3. One-time credit packs must never appear in any included set.
 *   4. Ultra carries all six Pro inclusions plus four Ultra-only additions.
 *   5. Pro's included set is a superset of Standard's.
 *   6. FEATURE_FLAGS must grant Pro/Ultra subscribers their bundled add-on features.
 *   7. Addon-to-feature-flag alignment for the whiteLabel→whiteLabel mapping.
 *
 * Add a key to ADDON_DEFINITIONS + ADDON_PRICE_IDS before adding it to
 * PLAN_INCLUDED_ADDONS or this suite will fail.
 */

import { describe, it, expect } from "vitest";
import {
  PLAN_INCLUDED_ADDONS,
  ADDON_PRICE_IDS,
  ADDON_PRICE_IDS_TEST,
  DEVELOPMENT_ADDON_DISPLAY_PRICES,
  getAddonDisplayPrice,
  BETA_ADDONS,
  COMING_SOON_ADDONS,
  VALIDATION_REQUIRED_ADDONS,
  getAddonAvailability,
  getAddonStatus,
  PLAN_ALLOWED_ADDONS,
  PROTECTED_ADDON_KEYS,
  REMOVED_ADDONS,
  isPlanAllowedAddon,
  ADDON_DEFINITIONS as CANONICAL_ADDON_DEFINITIONS,
} from "./plans.js";
import { ADDON_DEFINITIONS } from "../services/addons-service.js";
import { FEATURE_FLAGS } from "./config.js";

const ONE_TIME_PACKS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

describe("V1 add-on catalogue contract", () => {
  it("uses working prices only as non-production catalogue display values", () => {
    expect(DEVELOPMENT_ADDON_DISPLAY_PRICES).toEqual({
      marketIntelligence: 12,
      aiCro: 12,
      revenueLeak: 12,
      aiForecasting: 15,
    });
    expect(getAddonDisplayPrice("marketIntelligence", "development")).toBe(12);
    expect(getAddonDisplayPrice("aiForecasting", "test")).toBe(15);
    expect(getAddonDisplayPrice("marketIntelligence", "production")).toBe(49);
    expect(getAddonDisplayPrice("aiCro", "production")).toBe(34);
    expect(getAddonDisplayPrice("revenueLeak", "production")).toBe(29);
    expect(getAddonDisplayPrice("aiForecasting", "production")).toBe(39);
    expect(getAddonDisplayPrice("unknown", "development")).toBeUndefined();
  });

  it("keeps the 41 product entries and all six protected legacy keys", () => {
    expect(Object.keys(CANONICAL_ADDON_DEFINITIONS)).toHaveLength(41);
    expect(Object.keys(CANONICAL_ADDON_DEFINITIONS)).toEqual(
      expect.arrayContaining([
        "monitorsPack10",
        "monitorsPack50",
        "gbpPerformanceLeads",
        "whiteLabel",
        "retention90d",
        "retention365d",
        "extraSeats",
      ]),
    );
  });

  it("preserves protected add-on prices, pack sizes, and recurring behavior", () => {
    expect(CANONICAL_ADDON_DEFINITIONS.monitorsPack10).toMatchObject({
      priceEur: 9,
      quantity: true,
      oneTime: false,
    });
    expect(CANONICAL_ADDON_DEFINITIONS.monitorsPack50).toMatchObject({
      priceEur: 19,
      quantity: true,
      oneTime: false,
    });
    expect(CANONICAL_ADDON_DEFINITIONS.whiteLabel.priceEur).toBe(17);
    expect(CANONICAL_ADDON_DEFINITIONS.gbpPerformanceLeads).toMatchObject({
      priceEur: 15,
      quantity: false,
      oneTime: false,
    });
    expect(CANONICAL_ADDON_DEFINITIONS.retention90d.priceEur).toBe(9);
    expect(CANONICAL_ADDON_DEFINITIONS.retention365d.priceEur).toBe(19);
    expect(CANONICAL_ADDON_DEFINITIONS.extraSeats).toMatchObject({
      quantity: true,
      oneTime: false,
    });
    expect(PROTECTED_ADDON_KEYS).toEqual(new Set([
      "whiteLabel", "advancedWebhooks", "retention90d",
      "advancedSeoLab", "backlinkIntelligence", "enterprisePermissions",
    ]));
    expect([
      CANONICAL_ADDON_DEFINITIONS.whiteLabel.priceEur,
      CANONICAL_ADDON_DEFINITIONS.advancedWebhooks.priceEur,
      CANONICAL_ADDON_DEFINITIONS.retention90d.priceEur,
      CANONICAL_ADDON_DEFINITIONS.advancedSeoLab.priceEur,
      CANONICAL_ADDON_DEFINITIONS.backlinkIntelligence.priceEur,
      CANONICAL_ADDON_DEFINITIONS.enterprisePermissions.priceEur,
    ]).toEqual([17, 14, 9, 29, 24, 19]);
  });

  it("opens every sellable non-protected add-on to Standard, Pro, and Ultra without changing protected gates", () => {
    const nonProtectedAddons = Object.keys(CANONICAL_ADDON_DEFINITIONS).filter(
      key => !PROTECTED_ADDON_KEYS.has(key),
    );
    const sellableAddons = Object.keys(CANONICAL_ADDON_DEFINITIONS).filter(key =>
      !PROTECTED_ADDON_KEYS.has(key) &&
      !REMOVED_ADDONS.has(key) &&
      ["available", "beta"].includes(getAddonAvailability(key))
    );
    expect(nonProtectedAddons).toHaveLength(35);
    expect(sellableAddons.length).toBeGreaterThan(0);
    for (const plan of ["standard", "pro", "ultra"]) {
      for (const key of sellableAddons) {
        expect(PLAN_ALLOWED_ADDONS[plan]?.has(key), `${key} on ${plan}`).toBe(true);
      }
    }

    // Snapshot the six protected purchase rules; this request must not widen them.
    expect(["standard", "pro", "ultra"].map(plan =>
      ["whiteLabel", "advancedWebhooks", "retention90d", "advancedSeoLab", "backlinkIntelligence", "enterprisePermissions"]
        .map(key => isPlanAllowedAddon(plan, key))
    )).toEqual([
      [false, false, true, false, false, false],
      [false, false, true, false, false, true],
      [false, false, true, false, false, true],
    ]);
  });

  it("does not broaden roadmap, validation-required, or removed add-ons", () => {
    for (const key of [...COMING_SOON_ADDONS, ...REMOVED_ADDONS]) {
      for (const plan of ["standard", "pro", "ultra"]) {
        expect(PLAN_ALLOWED_ADDONS[plan]?.has(key), `${key} on ${plan}`).toBe(false);
      }
    }
    // Validation-required Local SEO offers had existing Pro/Ultra matrix entries;
    // their activation and checkout gates are outside this plan-access change.
    for (const key of VALIDATION_REQUIRED_ADDONS) {
      expect(PLAN_ALLOWED_ADDONS.standard?.has(key)).toBe(false);
      expect(PLAN_ALLOWED_ADDONS.pro?.has(key)).toBe(true);
      expect(PLAN_ALLOWED_ADDONS.ultra?.has(key)).toBe(true);
    }
  });

  it("keeps the legacy Local SEO offers gated until their replacement rollout is complete", () => {
    const keys = ["aiGbpPosting", "reviewIntelligence", "localDominationMaps"];
    expect(Object.keys(CANONICAL_ADDON_DEFINITIONS)).toHaveLength(41);
    expect(keys.map(key => CANONICAL_ADDON_DEFINITIONS[key].priceEur)).toEqual([12, 9, 15]);
    for (const key of keys) {
      expect(VALIDATION_REQUIRED_ADDONS.has(key)).toBe(true);
      expect(getAddonAvailability(key)).toBe("coming_soon");
      expect(getAddonStatus(key)).toBe("coming_soon");
      expect(getAddonStatus(key, { included: true })).toBe("included");
    }
  });
});

// Collect every addon key that appears in any plan's included set.
const allIncludedKeys = new Set<string>();
for (const set of Object.values(PLAN_INCLUDED_ADDONS)) {
  for (const key of set) allIncludedKeys.add(key);
}

describe("PLAN_INCLUDED_ADDONS integrity", () => {
  it("every included addon key has a Stripe price ID in ADDON_PRICE_IDS", () => {
    const missing: string[] = [];
    for (const key of allIncludedKeys) {
      if (!ADDON_PRICE_IDS[key]) missing.push(key);
    }
    expect(missing, `Keys in PLAN_INCLUDED_ADDONS without a Stripe price ID: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("every included addon key is defined in ADDON_DEFINITIONS", () => {
    const missing: string[] = [];
    for (const key of allIncludedKeys) {
      if (!ADDON_DEFINITIONS[key]) missing.push(key);
    }
    expect(missing, `Keys in PLAN_INCLUDED_ADDONS missing from ADDON_DEFINITIONS: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("no one-time credit pack appears in any plan's included set", () => {
    const found: string[] = [];
    for (const key of allIncludedKeys) {
      if (ONE_TIME_PACKS.has(key)) found.push(key);
    }
    expect(found, `One-time packs must not be in PLAN_INCLUDED_ADDONS: ${found.join(", ")}`).toHaveLength(0);
  });

  it("Ultra includes all six Pro add-ons and exactly four additional add-ons", () => {
    const ultraSet = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set<string>();
    const proSet   = PLAN_INCLUDED_ADDONS["pro"]   ?? new Set<string>();
    const missing: string[] = [];
    for (const key of proSet) {
      if (!ultraSet.has(key)) missing.push(key);
    }
    expect(missing, `Pro add-ons not present in Ultra: ${missing.join(", ")}`).toHaveLength(0);
    expect(ultraSet.has("retention90d")).toBe(true);
    expect(ultraSet.has("retention365d")).toBe(true);
    expect(proSet.size).toBe(6);
    expect(ultraSet.size).toBe(10);
    expect([...ultraSet].filter(key => !proSet.has(key)).sort()).toEqual([
      "aiForecasting",
      "behavioralAI",
      "customDomain",
      "retention365d",
    ]);
  });

  it("pro's included set is a superset of standard's (cumulative model)", () => {
    const proSet      = PLAN_INCLUDED_ADDONS["pro"]      ?? new Set<string>();
    const standardSet = PLAN_INCLUDED_ADDONS["standard"] ?? new Set<string>();
    const missing: string[] = [];
    for (const key of standardSet) {
      if (!proSet.has(key)) missing.push(key);
    }
    expect(missing, `Standard add-ons not present in Pro: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("all three canonical plan keys are present in the map", () => {
    expect(PLAN_INCLUDED_ADDONS).toHaveProperty("standard");
    expect(PLAN_INCLUDED_ADDONS).toHaveProperty("pro");
    expect(PLAN_INCLUDED_ADDONS).toHaveProperty("ultra");
  });
});
describe("FEATURE_FLAGS entitlement alignment with PLAN_INCLUDED_ADDONS", () => {
  // whiteLabel is bundled in Pro → Pro feature flag must be true
  it("FEATURE_FLAGS.pro.whiteLabel is true (whiteLabel bundled in Pro)", () => {
    expect(PLAN_INCLUDED_ADDONS["pro"]?.has("whiteLabel")).toBe(true);
    expect(FEATURE_FLAGS["pro"].whiteLabel).toBe(true);
  });

  // whiteLabel is bundled in Standard → Standard feature flag must be true
  it("FEATURE_FLAGS.standard.whiteLabel is true (whiteLabel bundled in Standard)", () => {
    expect(PLAN_INCLUDED_ADDONS["standard"]?.has("whiteLabel")).toBe(true);
    expect(FEATURE_FLAGS["standard"].whiteLabel).toBe(true);
  });

  // customDomain is bundled in Ultra only → Pro must be false, Ultra must be true
  it("FEATURE_FLAGS.pro.customDomain is false (customDomain not bundled in Pro)", () => {
    expect(PLAN_INCLUDED_ADDONS["pro"]?.has("customDomain")).toBe(false);
    expect(FEATURE_FLAGS["pro"].customDomain).toBe(false);
  });

  it("FEATURE_FLAGS.ultra.customDomain is true (customDomain bundled in Ultra)", () => {
    expect(PLAN_INCLUDED_ADDONS["ultra"]?.has("customDomain")).toBe(true);
    expect(FEATURE_FLAGS["ultra"].customDomain).toBe(true);
  });

  it("prioritySupport is neither bundled nor enabled because it is not implemented", () => {
    expect(PLAN_INCLUDED_ADDONS["pro"]?.has("prioritySupport")).toBe(false);
    expect(FEATURE_FLAGS["pro"].prioritySupport).toBe(false);
    expect(FEATURE_FLAGS["ultra"].prioritySupport).toBe(false);
  });
});

describe("addons entitlement merge logic", () => {
  it("plan-included addons are overlaid onto an empty org_addons map", () => {
    // Simulate what addons.ts GET /addons and billing-context.ts do:
    // when org_addons is empty, bundled plan addons should still appear as true.
    const plan = "pro";
    const orgAddons: Record<string, boolean | number> = {}; // empty — no manual activations
    const liveAddons: Record<string, boolean | number> = { ...orgAddons };
    const planIncluded = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
    for (const key of planIncluded) {
      if (!(key in liveAddons)) liveAddons[key] = true;
    }
    expect(liveAddons["whiteLabel"]).toBe(true);
    expect(liveAddons["advancedWebhooks"]).toBe(true);
    expect(liveAddons["prioritySupport"]).toBeUndefined();
    expect(liveAddons["retention90d"]).toBe(true);
    // customDomain must NOT appear for a Pro subscriber
    expect(liveAddons["customDomain"]).toBeUndefined();
  });

  it("plan-included addons do not override an explicitly deactivated org addon", () => {
    // If an org_addon row exists with active=false, the DB value wins.
    const plan = "pro";
    const orgAddons: Record<string, boolean | number> = { whiteLabel: false };
    const liveAddons: Record<string, boolean | number> = { ...orgAddons };
    const planIncluded = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
    for (const key of planIncluded) {
      if (!(key in liveAddons)) liveAddons[key] = true;
    }
    // The explicit false from org_addons must be preserved (key already exists)
    expect(liveAddons["whiteLabel"]).toBe(false);
  });

  it("ultra subscriber gets all pro bundled addons plus ultra-only ones", () => {
    const plan = "ultra";
    const liveAddons: Record<string, boolean | number> = {};
    const planIncluded = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
    for (const key of planIncluded) {
      if (!(key in liveAddons)) liveAddons[key] = true;
    }
    expect(liveAddons["whiteLabel"]).toBe(true);
    expect(liveAddons["customDomain"]).toBe(true);
    expect(liveAddons["retention365d"]).toBe(true);
    expect(liveAddons["retention90d"]).toBe(true);
    expect(liveAddons["behavioralAI"]).toBe(true);
    expect(liveAddons["aiForecasting"]).toBe(true);
    expect(liveAddons["keywordDomination"]).toBeUndefined();
  });
});

describe("canonical add-on availability", () => {
  it("keeps beta classification free of coming_soon add-ons (BETA ∩ INCLUDED is intentionally non-empty)", () => {
    // Beta describes feature maturity; included describes commercial mode.
    // A beta add-on can be bundled in a plan (e.g. Ultra) and shown as
    // "🧪 Beta — Inclus dans votre plan" — this is intentional FlowPoint behaviour.
    // The only forbidden overlap is BETA ∩ COMING_SOON (roadmap items cannot
    // be simultaneously described as in-progress / beta).
    expect([...BETA_ADDONS].filter((key) => COMING_SOON_ADDONS.has(key))).toEqual([]);
  });

  it("reports product lifecycle independently of entitlement", () => {
    expect(getAddonAvailability("globalMonitoring")).toBe("coming_soon");
    expect(getAddonAvailability("aiWorkspaceLaunch")).toBe("coming_soon");
    expect(getAddonAvailability("abTestingAI")).toBe("coming_soon");
    expect(COMING_SOON_ADDONS.has("abTestingAI")).toBe(true);
    const gbpTestPriceReady = Boolean(ADDON_PRICE_IDS_TEST.gbpPerformanceLeads) &&
      (process.env["STRIPE_TEST_MODE"] === "true") &&
      (process.env["STRIPE_TEST_KEY"] ?? "").startsWith("sk_test_");
    expect(getAddonAvailability("gbpPerformanceLeads")).toBe(gbpTestPriceReady ? "available" : "coming_soon");
    expect(getAddonAvailability("marketIntelligence")).toBe("beta");
    expect(getAddonAvailability("monitorsPack10")).toBe("available");
  });

  it("uses coming-soon, included, active, beta, available precedence", () => {
    expect(getAddonStatus("globalMonitoring", { included: true, active: true })).toBe("coming_soon");
    expect(getAddonStatus("aiWorkspaceLaunch", { active: true })).toBe("coming_soon");
    expect(getAddonStatus("whiteLabel", { included: true, active: true })).toBe("included");
    expect(getAddonStatus("monitorsPack10", { active: 2 })).toBe("active");
    expect(getAddonStatus("marketIntelligence")).toBe("beta");
    expect(getAddonStatus("monitorsPack10")).toBe("available");
  });
});
