/**
 * plans.test.ts — integrity checks for PLAN_INCLUDED_ADDONS and entitlement consistency.
 *
 * These tests enforce the "single source of truth" invariant:
 *   1. Every key in any plan's included set must have a Stripe price ID.
 *   2. Every key in any plan's included set must be defined in ADDON_DEFINITIONS.
 *   3. One-time credit packs must never appear in any included set.
 *   4. Ultra carries Pro inclusions except retention90d, which is upgraded to retention365d.
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
  BETA_ADDONS,
  COMING_SOON_ADDONS,
  getAddonAvailability,
  getAddonStatus,
} from "./plans.js";
import { ADDON_DEFINITIONS } from "../services/addons-service.js";
import { FEATURE_FLAGS } from "./config.js";

const ONE_TIME_PACKS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

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

  it("ultra carries Pro inclusions but upgrades retention90d to retention365d", () => {
    const ultraSet = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set<string>();
    const proSet   = PLAN_INCLUDED_ADDONS["pro"]   ?? new Set<string>();
    const missing: string[] = [];
    for (const key of proSet) {
      if (key === "retention90d") continue;
      if (!ultraSet.has(key)) missing.push(key);
    }
    expect(missing, `Pro add-ons not present in Ultra: ${missing.join(", ")}`).toHaveLength(0);
    expect(ultraSet.has("retention90d")).toBe(false);
    expect(ultraSet.has("retention365d")).toBe(true);
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
    expect(liveAddons["keywordDomination"]).toBe(true);
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
