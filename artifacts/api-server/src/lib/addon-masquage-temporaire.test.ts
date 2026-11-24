import { describe, expect, it } from "vitest";
import { ADDON_DEFINITIONS, BETA_ADDONS, COMING_SOON_ADDONS, PLAN_INCLUDED_ADDONS, FLAG_ADDONS, QTY_ADDONS, getAddonAvailability, isPlanAllowedAddon } from "./plans.js";

describe("retrait temporaire de la vente : gbpSlots10 et reviewIntelligence", () => {
  for (const key of ["gbpSlots10", "reviewIntelligence"]) {
    it(`${key} : non vendable, reconnu pour les droits existants`, () => {
      expect(getAddonAvailability(key)).toBe("coming_soon");
      for (const plan of ["standard", "pro", "ultra"]) expect(isPlanAllowedAddon(plan, key)).toBe(false);
      // La definition reste connue : les droits et abonnements existants continuent d'etre reconnus.
      expect(ADDON_DEFINITIONS[key]).toBeDefined();
      expect(FLAG_ADDONS.has(key) || QTY_ADDONS.has(key)).toBe(true);
    });
  }
});

describe("remise en vente : localDominationMaps et zapierIntegration", () => {
  for (const key of ["localDominationMaps", "zapierIntegration"]) {
    it(`${key} : vendable Pro/Ultra, pas Standard, pas coming_soon`, () => {
      expect(COMING_SOON_ADDONS.has(key)).toBe(false);
      expect(getAddonAvailability(key)).not.toBe("coming_soon");
      expect(isPlanAllowedAddon("pro", key)).toBe(true);
      expect(isPlanAllowedAddon("ultra", key)).toBe(true);
      expect(isPlanAllowedAddon("standard", key)).toBe(false);
      expect(ADDON_DEFINITIONS[key]).toBeDefined();
    });
  }
});

describe("masquage : add-ons dont les tables manquent en production", () => {
  for (const key of ["aiGbpPosting", "marketIntelligence", "aiCro", "revenueLeak", "crmIntegration"]) {
    it(`${key} : coming_soon, non vendable, definition conservee`, () => {
      expect(COMING_SOON_ADDONS.has(key)).toBe(true);
      expect(BETA_ADDONS.has(key)).toBe(false);
      expect(getAddonAvailability(key)).toBe("coming_soon");
      for (const plan of ["standard", "pro", "ultra"]) expect(isPlanAllowedAddon(plan, key)).toBe(false);
      expect(ADDON_DEFINITIONS[key]).toBeDefined();
    });
  }
  it("behavioralAI : plus achetable en Pro, reste inclus Ultra", () => {
    expect(isPlanAllowedAddon("pro", "behavioralAI")).toBe(false);
    expect(PLAN_INCLUDED_ADDONS["ultra"]!.has("behavioralAI")).toBe(true);
  });
});
