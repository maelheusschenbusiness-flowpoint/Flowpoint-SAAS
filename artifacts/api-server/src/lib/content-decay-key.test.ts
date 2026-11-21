import { describe, expect, it } from "vitest";
import { ADDON_DEFINITIONS, ADDON_PRICE_IDS, COMING_SOON_ADDONS, FLAG_ADDONS } from "./plans.js";

describe("cles distinctes : AI Content Strategist / SEO Content Decay Radar", () => {
  it("sont deux produits distincts, sans droits ni prix partages", () => {
    expect(ADDON_DEFINITIONS["aiContentStrategist"]?.name).toBe("AI Content Strategist");
    expect(ADDON_DEFINITIONS["aiContentStrategist"]?.priceEur).toBe(34);
    expect(ADDON_DEFINITIONS["seoContentDecayRadar"]?.name).toBe("SEO Content Decay Radar");
    expect(ADDON_DEFINITIONS["seoContentDecayRadar"]?.priceEur).toBe(12);
    expect(FLAG_ADDONS.has("aiContentStrategist")).toBe(true);
    expect(FLAG_ADDONS.has("seoContentDecayRadar")).toBe(true);
    expect(ADDON_PRICE_IDS["seoContentDecayRadar"]).not.toBe(ADDON_PRICE_IDS["aiContentStrategist"]);
    // Aucun prix LIVE pour le Radar tant que le produit n'est pas cree.
    expect(ADDON_PRICE_IDS["seoContentDecayRadar"] || "").toBe("");
  });

  it("restent non vendables tant qu'ils ne sont pas valides", () => {
    expect(COMING_SOON_ADDONS.has("aiContentStrategist")).toBe(true);
    expect(COMING_SOON_ADDONS.has("seoContentDecayRadar")).toBe(true);
  });
});
