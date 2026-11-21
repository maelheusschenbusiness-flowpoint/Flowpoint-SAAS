import { describe, expect, it } from "vitest";
import { ADDON_PRICE_IDS, ADDON_PRICE_IDS_TEST, getAddonPriceId } from "./plans.js";

describe("separation des identifiants de prix TEST et LIVE", () => {
  it("sans variable TEST, le mode TEST ne fabrique pas d'identifiant : repli LIVE inchange", () => {
    // Comportement historique conserve : tant qu'aucune variable TEST n'est posee, rien ne change.
    for (const key of ["auditsPack200", "auditsPack1000", "pdfPack200", "exportsPack1000", "localDominationMaps", "zapierIntegration"]) {
      expect(getAddonPriceId(key, "sk_live_x")).toBe(ADDON_PRICE_IDS[key]);
      expect(ADDON_PRICE_IDS_TEST[key] ?? "").toBe("");
    }
  });

  it("une cle LIVE ne renvoie jamais un identifiant TEST", () => {
    for (const key of Object.keys(ADDON_PRICE_IDS_TEST)) {
      expect(getAddonPriceId(key, "sk_live_x")).toBe(ADDON_PRICE_IDS[key] || undefined);
    }
  });
});
