import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  ADDON_DEFINITIONS,
  getAddonAvailability,
  getAddonPurchasablePlans,
  isPlanAllowedAddon,
  PLAN_INCLUDED_ADDONS,
  PROTECTED_ADDON_KEYS,
  REMOVED_ADDONS,
  RETIRED_ADDONS,
} from "./plans.js";
import { createBillingQuote } from "../services/billing-quote.js";
import { ADDON_CATALOG } from "../services/billing-service.js";
import plansRouter from "../routes/plans.js";

vi.hoisted(() => {
  process.env["STRIPE_TEST_MODE"] = "false";
});

vi.mock("../services/stripe-factory.js", () => ({
  getStripeKey: vi.fn(() => "sk_live_catalog_fixture"),
  isStripeTestMode: vi.fn(() => false),
  createStripeClient: vi.fn(async () => null),
}));

const dashboardPath = fileURLToPath(
  new URL("../../../../src/frontend/dashboard.js", import.meta.url),
);
const exportPath = fileURLToPath(
  new URL("../../../flowpoint-export/dashboard.js", import.meta.url),
);
const pricingPath = fileURLToPath(
  new URL("../../../flowpoint-export/pricing.html", import.meta.url),
);
const dashboard = readFileSync(dashboardPath, "utf8");
const exportedDashboard = readFileSync(exportPath, "utf8");
const pricing = readFileSync(pricingPath, "utf8");

function loadPolicy(source: string) {
  const match = source.match(
    /\/\* addon-catalog-policy:start \*\/([\s\S]*?)\/\* addon-catalog-policy:end \*\//,
  );
  if (!match) throw new Error("Add-on catalog policy block is missing");
  return new Function(
    "fpT",
    `${match[1]}\nreturn { _fpAddonPurchaseState, _fpAddonAccessLabel };`,
  )((key: string) => key) as {
    _fpAddonPurchaseState: (
      addon: Record<string, unknown>,
      plan: string,
      included: boolean,
    ) => string;
    _fpAddonAccessLabel: (state: string) => string;
  };
}

function loadPricingPolicy(document: unknown = {}, language: "fr" | "en" = "fr") {
  const match = pricing.match(
    /\/\* addon-pricing-policy:start \*\/([\s\S]*?)\/\* addon-pricing-policy:end \*\//,
  );
  if (!match) throw new Error("Pricing add-on policy block is missing");
  return new Function(
    "document",
    "window",
    `${match[1]}\nreturn { _fpPricingAddonState, _fpPricingText, _fpPricingAddonStateLabel, _fpPricingAddonDisabledDescription, _fpPricingCartRejection, _fpPricingQuantityLabel, _fpSetAddonQuantityControls, _fpSetPricingCatalogState };`,
  )(document, {
    fpPublicText: (french: string, english: string) => language === "en" ? english : french,
  }) as {
    _fpPricingAddonState: (
      addon: Record<string, unknown>,
      plan: string,
      includedKeys?: string[],
    ) => string;
    _fpPricingText: (french: string, english: string) => string;
    _fpPricingAddonStateLabel: (state: string) => string;
    _fpPricingAddonDisabledDescription: (state: string) => string;
    _fpPricingCartRejection: (state: string) => string;
    _fpPricingQuantityLabel: (addonName: string, direction: number) => string;
    _fpSetAddonQuantityControls: (
      card: { querySelectorAll: (selector: string) => ArrayLike<{
        disabled: boolean;
        title?: string;
        setAttribute: (name: string, value: string) => void;
        removeAttribute: (name: string) => void;
      }> },
      addonName: string,
      state: string,
      isActive: boolean,
    ) => void;
    _fpSetPricingCatalogState: (state: "loading" | "ready" | "error") => void;
  };
}

describe("add-on catalogue UI commercial gates", () => {
  const policy = loadPolicy(dashboard);

  it("keeps the served and exported dashboards identical", () => {
    expect(exportedDashboard).toBe(dashboard);
  });

  it("describes Custom Domain as a restricted Stripe TEST beta", () => {
    const betaCopy = "Bêta sur Stripe TEST, réservée aux organisations Ultra autorisées.";
    expect(dashboard).toContain(betaCopy);
    expect(dashboard).toContain(`"${betaCopy}": "Stripe TEST beta; authorized Ultra organizations only."`);
    expect(dashboard).not.toContain("activation masquée jusqu’à la certification Beta");
    expect(ADDON_DEFINITIONS.customDomain.description).toBe(betaCopy);
  });

  it("keeps pricing availability and purchase readiness distinct and localizes add-on expansion", () => {
    expect(pricing).toContain('purchaseStatus === "price_unavailable"');
    expect(pricing).toContain('_fpPricingText("Voir moins", "See less")');
    expect(pricing).toContain('aria-controls="fp-addons-grid"');
    const toggleBlock = pricing.match(
      /window\.toggleAddons = function \(\) \{([\s\S]*?)\n  \};/,
    )?.[1];
    expect(toggleBlock).toContain("dataset.hiddenCount");
    expect(toggleBlock).not.toContain("'Voir moins'");
    expect(toggleBlock).not.toContain("24 de plus");
  });

  it("shows an accessible GBP state for missing entitlement and provider failures", () => {
    expect(dashboard).toContain("gbpPerformanceError");
    expect(dashboard).toContain("status === 402");
    expect(dashboard).toContain("status === 502");
    expect(dashboard).toContain('role="alert"');
    expect(dashboard).toContain("data-fp-gbp-performance-retry");
  });

  it("keeps AI post generation editable and stores the selected generation settings", () => {
    for (const field of [
      "fp-gbp-post-type",
      "fp-gbp-language",
      "fp-gbp-industry",
      "fp-gbp-tone",
      "fp-gbp-objective",
      "fp-gbp-keywords",
      "fp-gbp-max-characters",
    ]) expect(dashboard).toContain(field);
    expect(dashboard).toContain("Vérifiez le texte");
    expect(dashboard).toContain("generationOptions");
  });

  it("never offers deactivation for an add-on active only because it is included", () => {
    expect(dashboard).toContain(": a.active && !isInc");
  });

  it("fails closed unless the backend catalogue and allowedPlans are present", () => {
    expect(policy._fpAddonPurchaseState({}, "pro", false)).toBe("catalog_unavailable");
    expect(
      policy._fpAddonPurchaseState(
        { catalogMissing: true, availability: "", allowedPlans: null },
        "pro",
        false,
      ),
    ).toBe("catalog_unavailable");
  });

  it("allows purchase only for a listed plan, while retaining purchasable beta offers", () => {
    expect(
      policy._fpAddonPurchaseState(
        { availability: "available", allowedPlans: ["pro", "ultra"] },
        "standard",
        false,
      ),
    ).toBe("plan_unavailable");
    expect(
      policy._fpAddonPurchaseState(
        { availability: "available", allowedPlans: ["pro", "ultra"] },
        "PRO",
        false,
      ),
    ).toBe("purchasable");
    expect(
      policy._fpAddonPurchaseState(
        { availability: "beta", allowedPlans: ["pro"] },
        "pro",
        false,
      ),
    ).toBe("purchasable");
  });

  it("prefers backend purchase blocks and plan inclusions over purchase", () => {
    expect(
      policy._fpAddonPurchaseState(
        { availability: "coming_soon", allowedPlans: ["pro"] },
        "pro",
        false,
      ),
    ).toBe("coming_soon");
    expect(
      policy._fpAddonPurchaseState(
        { availability: "available", allowedPlans: [] },
        "pro",
        true,
      ),
    ).toBe("included");
  });

  it("shows the requested unavailable-state labels", () => {
    expect(policy._fpAddonAccessLabel("included")).toBe("Inclus");
    expect(policy._fpAddonAccessLabel("coming_soon")).toBe("Bientôt");
    expect(policy._fpAddonAccessLabel("plan_unavailable")).toBe(
      "Non disponible avec votre forfait",
    );
  });

  it("keeps the UI button and backend authorization aligned for all 32 non-protected add-ons on all plans", () => {
    const plans = ["standard", "pro", "ultra"] as const;
    const keys = Object.keys(ADDON_DEFINITIONS).filter(
      key => !PROTECTED_ADDON_KEYS.has(key) && !RETIRED_ADDONS.has(key),
    );
    expect(keys).toHaveLength(32);

    for (const key of keys) {
      const removed = REMOVED_ADDONS.has(key) || RETIRED_ADDONS.has(key);
      const availability = getAddonAvailability(key);
      const sellable = !removed && ["available", "beta"].includes(availability);
      const allowedPlans = getAddonPurchasablePlans(key);

      for (const plan of plans) {
        const included = PLAN_INCLUDED_ADDONS[plan]?.has(key) ?? false;
        const catalogEntry = removed
          ? { catalogMissing: true, availability: "", allowedPlans: null }
          : { availability, allowedPlans };
        const uiState = policy._fpAddonPurchaseState(catalogEntry, plan, included);
        const backendCanBill = sellable && !included && allowedPlans.includes(plan);

        if (availability === "coming_soon") {
          expect(uiState, `${key} UI on ${plan}`).toBe("coming_soon");
        } else if (removed) {
          expect(uiState, `${key} UI on ${plan}`).toBe("catalog_unavailable");
        } else if (included) {
          expect(uiState, `${key} UI on ${plan}`).toBe("included");
        } else {
          expect(uiState === "purchasable", `${key} UI on ${plan}`).toBe(backendCanBill);
        }

        if (sellable && !included && allowedPlans.includes(plan)) {
          expect(isPlanAllowedAddon(plan, key), `${key} policy matrix on ${plan}`).toBe(true);
        }
      }
    }
  });

  it("publishes the canonical catalogue and omits retired offers", async () => {
    const app = express();
    app.use(plansRouter);
    const response = await request(app).get("/plans/catalog").expect(200);
    const entries = new Map<string, {
      key: string;
      availability: string;
      allowedPlans: string[];
    }>(response.body.addons.map((addon: { key: string; availability: string; allowedPlans: string[] }) => [
      addon.key,
      addon,
    ]));
    expect(entries.size).toBe(35);
    const billingPlansById = new Map(
      ADDON_CATALOG.map(addon => [addon.id, addon.allowedPlans]),
    );
    for (const entry of entries.values()) {
      expect(billingPlansById.get(entry.key), `${entry.key} matches /billing/plans`).toEqual(
        entry.allowedPlans,
      );
    }
    const plans = ["standard", "pro", "ultra"] as const;
    const keys = Object.keys(ADDON_DEFINITIONS).filter(
      key => !PROTECTED_ADDON_KEYS.has(key) && !RETIRED_ADDONS.has(key),
    );
    expect(keys).toHaveLength(32);
    expect(entries.has("prioritySupport")).toBe(false);

    for (const key of keys) {
      if (REMOVED_ADDONS.has(key) || RETIRED_ADDONS.has(key)) continue;
      const entry = entries.get(key);
      expect(entry, `${key} should exist in the public catalog`).toBeDefined();
      if (!entry) continue;

      const sellable = ["available", "beta"].includes(entry.availability);
      const includedByPlan = response.body.includedByPlan as Record<string, string[]>;
      const purchasablePlans = getAddonPurchasablePlans(key);
      for (const plan of plans) {
        const included = includedByPlan[plan]?.includes(key) ?? false;
        const uiState = policy._fpAddonPurchaseState(entry, plan, included);
        const backendCanBill = sellable && !included && purchasablePlans.includes(plan);

        expect(entry.allowedPlans.includes(plan), `${key} catalog on ${plan}`).toBe(
          purchasablePlans.includes(plan),
        );
        if (sellable && !included && purchasablePlans.includes(plan)) {
          expect(isPlanAllowedAddon(plan, key), `${key} policy matrix on ${plan}`).toBe(true);
          expect(uiState, `${key} button on ${plan}`).toBe("purchasable");
        } else if (included && entry.availability !== "coming_soon") {
          expect(uiState, `${key} button on ${plan}`).toBe("included");
        } else if (entry.availability === "coming_soon") {
          expect(uiState, `${key} button on ${plan}`).toBe("coming_soon");
        }
        expect(uiState === "purchasable", `${key} button/authorization on ${plan}`).toBe(
          backendCanBill,
        );
      }
    }

    const retired = [
      "gbpSlots10",
      "reviewIntelligence",
      "localDominationMaps",
      "abTestingAI",
      "aiWorkflows",
      "enterprisePermissions",
      "advancedWebhooks",
      "zapierIntegration",
      "auditsPack200",
      "auditsPack1000",
      "pdfPack200",
      "exportsPack1000",
    ];
    const replacements = [
      ["gbpPerformanceLeads", 15],
      ["localPresenceOptimizer", 9],
      ["localLandingOpportunities", 15],
      ["conversionOpportunityEngine", 12],
      ["seoChangeImpact", 15],
      ["agencyPortfolioPriorities", 19],
      ["technicalSeoFixVerification", 19],
      ["organicCampaignTracker", 12],
    ] as const;

    for (const key of retired) {
      expect(RETIRED_ADDONS.has(key), `${key} remains a historical key`).toBe(true);
      expect(ADDON_DEFINITIONS[key], `${key} remains defined for existing entitlements`).toBeDefined();
      expect(entries.has(key), `${key} is absent from new sales`).toBe(false);
    }
    expect(response.body.retiredAddonKeys).toEqual(expect.arrayContaining(retired));
    for (const [key, priceEur] of replacements) {
      expect(entries.has(key), `${key} is present in the canonical catalog`).toBe(true);
      expect(ADDON_DEFINITIONS[key]?.priceEur, `${key} has the approved price`).toBe(priceEur);
    }

    const includedByPlan = response.body.includedByPlan as Record<string, string[]>;
    expect(includedByPlan.standard).toHaveLength(1);
    expect(includedByPlan.pro).toHaveLength(6);
    expect(includedByPlan.ultra).toHaveLength(10);
    expect(includedByPlan.pro).toContain("enterprisePermissions");
    expect(includedByPlan.ultra).toContain("advancedWebhooks");
    expect(includedByPlan.pro).not.toContain("keywordDomination");
    for (const key of [
      "monitorsPack10",
      "monitorsPack50",
      "whiteLabel",
      "extraSeats",
      "retention90d",
      "retention365d",
      "customDomain",
    ]) {
      expect(RETIRED_ADDONS.has(key), `${key} stays protected`).toBe(false);
      expect(ADDON_DEFINITIONS[key]).toBeDefined();
    }

    const publicBillingIds = new Set(ADDON_CATALOG.map(addon => addon.id));
    expect(ADDON_CATALOG).toHaveLength(35);
    for (const key of retired) expect(publicBillingIds.has(key)).toBe(false);
    for (const [key] of replacements) expect(publicBillingIds.has(key)).toBe(true);
  });

  it("keeps retired capacity packs out of the marketplace and matches the monthly catalogue", () => {
    const match = dashboard.match(/const allAddons = \[([\s\S]*?)\n\s*\];/);
    expect(match, "add-on card definitions should be present").not.toBeNull();
    const keys = [...(match?.[1] ?? "").matchAll(/key:\s*'([^']+)'/g)].map(item => item[1]);
    expect(keys).toHaveLength(32);
    expect(new Set(keys).size).toBe(keys.length);
    expect(exportedDashboard).toBe(dashboard);
    const monthlyCatalogKeys = Object.entries(ADDON_DEFINITIONS)
      .filter(([key, def]) => !def.oneTime && !REMOVED_ADDONS.has(key) && !RETIRED_ADDONS.has(key))
      .map(([key]) => key)
      .sort();
    expect([...keys].sort()).toEqual(monthlyCatalogKeys);
    for (const key of ["auditsPack200", "auditsPack1000", "pdfPack200", "exportsPack1000"]) {
      expect(RETIRED_ADDONS.has(key)).toBe(true);
      expect(keys, `${key} must not be listed for new purchases`).not.toContain(key);
      expect(dashboard, `${key} remains manageable as a historical entitlement`).toContain(key);
    }
    for (const key of [
      "gbpSlots10",
      "reviewIntelligence",
      "localDominationMaps",
      "abTestingAI",
      "aiWorkflows",
      "enterprisePermissions",
      "advancedWebhooks",
      "zapierIntegration",
    ]) {
      expect(keys, `${key} is not a new-sale card`).not.toContain(key);
    }
    for (const key of [
      "gbpPerformanceLeads",
      "localPresenceOptimizer",
      "localLandingOpportunities",
      "conversionOpportunityEngine",
      "seoChangeImpact",
      "agencyPortfolioPriorities",
      "technicalSeoFixVerification",
      "organicCampaignTracker",
    ]) {
      expect(keys, `${key} replaces an old card`).toContain(key);
    }
  });

  it("renders the pricing cards from the canonical API catalogue, not retired static offers", () => {
    expect(pricing).toContain("_fpRenderAddonCards(cat)");
    expect(pricing).toContain("cat.retiredAddonKeys");
    expect(pricing).toContain("retiredCartItemsRemoved");
    expect(pricing).toContain("cat.addons.filter(function (addon) { return !addon.oneTime; })");
    expect(pricing).toContain("data-addon-key");
    expect(pricing).toContain("role=\"alert\"");
  });

  it("gates pricing buttons by purchase eligibility across Standard, Pro, and Ultra", () => {
    const pricingPolicy = loadPricingPolicy();
    const protectedOffer = {
      key: "advancedSeoLab",
      availability: "available",
      allowedPlans: [],
      includedByPlan: { pro: true, ultra: true },
    };
    expect(pricingPolicy._fpPricingAddonState(protectedOffer, "standard")).toBe("catalog_unavailable");
    expect(pricingPolicy._fpPricingAddonState(protectedOffer, "pro")).toBe("included");
    expect(pricingPolicy._fpPricingAddonState(protectedOffer, "ultra")).toBe("included");

    const proOnly = {
      key: "fixtureProOffer",
      availability: "beta",
      allowedPlans: ["pro", "ultra"],
      includedByPlan: {},
    };
    expect(pricingPolicy._fpPricingAddonState(proOnly, "standard")).toBe("plan_unavailable");
    expect(pricingPolicy._fpPricingAddonState(proOnly, "pro")).toBe("purchasable");
    expect(pricingPolicy._fpPricingAddonState(proOnly, "ultra")).toBe("purchasable");

    const noTestPrice = {
      key: "aiCreditsPack50k",
      availability: "available",
      allowedPlans: [],
      includedByPlan: {},
    };
    for (const plan of ["standard", "pro", "ultra"]) {
      expect(pricingPolicy._fpPricingAddonState(noTestPrice, plan)).toBe("catalog_unavailable");
    }
  });

  it("disables every unavailable quantity control and exposes its accessible state", () => {
    const pricingPolicy = loadPricingPolicy();
    const noTestPrice = {
      key: "aiCreditsPack200k",
      availability: "available",
      allowedPlans: [],
      includedByPlan: {},
    };
    const makeSteps = () => [0, 1].map(() => {
      const attributes: Record<string, string> = {};
      return {
        disabled: false,
        title: "",
        attributes,
        setAttribute(name: string, value: string) { attributes[name] = value; },
        removeAttribute(name: string) {
          delete attributes[name];
          if (name === "title") this.title = "";
        },
      };
    });

    for (const plan of ["standard", "pro", "ultra"]) {
      const state = pricingPolicy._fpPricingAddonState(noTestPrice, plan);
      const steps = makeSteps();
      pricingPolicy._fpSetAddonQuantityControls(
        { querySelectorAll: () => steps },
        "+200 000 crédits IA",
        state,
        false,
      );
      for (const [index, step] of steps.entries()) {
        expect(step.disabled, `${plan} step ${index} is natively disabled`).toBe(true);
        expect(step.attributes["aria-disabled"]).toBe("true");
        expect(step.attributes["aria-label"]).toBe(
          index === 0
            ? "Réduire la quantité de +200 000 crédits IA"
            : "Augmenter la quantité de +200 000 crédits IA",
        );
        expect(step.title).toBe("Aucun prix achetable n'est configuré pour cet add-on.");
      }
    }

    const availableSteps = makeSteps();
    pricingPolicy._fpSetAddonQuantityControls(
      { querySelectorAll: () => availableSteps },
      "Pack crédits IA",
      "purchasable",
      false,
    );
    expect(availableSteps.every(step => !step.disabled)).toBe(true);
    expect(availableSteps.every(step => step.attributes["aria-disabled"] === "false")).toBe(true);

    const activeSteps = makeSteps();
    pricingPolicy._fpSetAddonQuantityControls(
      { querySelectorAll: () => activeSteps },
      "Pack crédits IA",
      "purchasable",
      true,
    );
    expect(activeSteps.every(step => step.disabled)).toBe(true);
    expect(activeSteps.every(step => step.title === "Cet add-on est déjà actif sur votre compte.")).toBe(true);
  });

  it("uses the selected language for loading, disabled descriptions, quantity labels, and cart refusals", () => {
    const english = loadPricingPolicy({}, "en");
    const french = loadPricingPolicy({}, "fr");

    expect(english._fpPricingText("Chargement des add-ons…", "Loading add-ons…")).toBe("Loading add-ons…");
    expect(french._fpPricingText("Chargement des add-ons…", "Loading add-ons…")).toBe("Chargement des add-ons…");
    expect(english._fpPricingAddonStateLabel("catalog_unavailable")).toBe("Unavailable");
    expect(english._fpPricingAddonDisabledDescription("catalog_unavailable")).toBe(
      "No purchasable price is configured for this add-on.",
    );
    expect(english._fpPricingQuantityLabel("AI credits", 1)).toBe("Increase quantity of AI credits");
    expect(english._fpPricingCartRejection("included")).toBe("This add-on is already included in your plan.");
    expect(english._fpPricingCartRejection("catalog_unavailable")).toBe(
      "This add-on cannot be purchased in the active billing mode.",
    );
    expect(french._fpPricingAddonDisabledDescription("catalog_unavailable")).toBe(
      "Aucun prix achetable n'est configuré pour cet add-on.",
    );
    expect(french._fpPricingCartRejection("included")).toBe(
      "Cet add-on est déjà inclus dans votre forfait.",
    );
  });

  it("keeps quantity and cart writes behind the active-mode eligibility guard", () => {
    const changeQtyStart = pricing.indexOf("window.changeQty = function");
    const quantityGuard = pricing.indexOf('if (eligibility !== "purchasable" ||', changeQtyStart);
    const quantityWrite = pricing.indexOf("_cart.addons[addonId] = next", changeQtyStart);
    expect(quantityGuard).toBeGreaterThan(changeQtyStart);
    expect(quantityWrite).toBeGreaterThan(quantityGuard);

    const addToCartStart = pricing.indexOf("window.addToCart = function");
    const cartGuard = pricing.indexOf('if (eligibility !== "purchasable")', addToCartStart);
    const cartWrite = pricing.indexOf("_cart.addons[addonId] = qty", addToCartStart);
    expect(cartGuard).toBeGreaterThan(addToCartStart);
    expect(cartWrite).toBeGreaterThan(cartGuard);
  });

  it("announces add-on catalogue loading and changes the accessible view state", () => {
    expect(pricing).toContain('id="fp-addon-catalog-loading"');
    expect(pricing).toContain('role="status"');
    expect(pricing).toContain('aria-live="polite"');
    expect(pricing).toContain('aria-busy="true"');

    const elements = new Map<string, {
      hidden: boolean;
      style: { display: string };
      dataset: Record<string, string>;
      attributes: Record<string, string>;
      textContent: string;
      setAttribute: (name: string, value: string) => void;
    }>();
    for (const id of ["fp-addon-catalog-loading", "fp-addons-grid"]) {
      elements.set(id, {
        hidden: false,
        style: { display: "none" },
        dataset: {},
        attributes: {},
        textContent: "",
        setAttribute(name, value) { this.attributes[name] = value; },
      });
    }
    const pricingPolicy = loadPricingPolicy({
      getElementById: (id: string) => elements.get(id) ?? null,
    });
    const loading = elements.get("fp-addon-catalog-loading")!;
    const grid = elements.get("fp-addons-grid")!;

    pricingPolicy._fpSetPricingCatalogState("loading");
    expect(loading.hidden).toBe(false);
    expect(grid.hidden).toBe(true);
    expect(grid.attributes["aria-busy"]).toBe("true");

    pricingPolicy._fpSetPricingCatalogState("ready");
    expect(loading.hidden).toBe(true);
    expect(grid.hidden).toBe(false);
    expect(grid.style.display).toBe("");
    expect(grid.attributes["aria-busy"]).toBe("false");

    pricingPolicy._fpSetPricingCatalogState("error");
    expect(loading.hidden).toBe(true);
    expect(grid.hidden).toBe(true);
    expect(grid.attributes["aria-busy"]).toBe("false");

    const englishPolicy = loadPricingPolicy({
      getElementById: (id: string) => elements.get(id) ?? null,
    }, "en");
    englishPolicy._fpSetPricingCatalogState("loading");
    expect(loading.textContent).toBe("Loading add-ons…");
  });

  it("does not let a retired add-on bypass the server-side quote guard", () => {
    const retired = [
      "gbpSlots10",
      "reviewIntelligence",
      "localDominationMaps",
      "abTestingAI",
      "aiWorkflows",
      "enterprisePermissions",
      "advancedWebhooks",
      "zapierIntegration",
      "auditsPack200",
      "auditsPack1000",
      "pdfPack200",
      "exportsPack1000",
    ];
    for (const key of retired) {
      expect(RETIRED_ADDONS.has(key)).toBe(true);
      expect(isPlanAllowedAddon("pro", key)).toBe(false);
      expect(
        () => createBillingQuote({ plan: "pro", addons: { [key]: true } }),
        `${key} must be rejected even when a client submits it directly`,
      ).toThrow("ADDON_RETIRED");
    }
  });

  it("removes unsupported quantified add-on outcomes from the marketplace copy", () => {
    const match = dashboard.match(/const allAddons = \[([\s\S]*?)\n\s*\];/);
    expect(match, "add-on card definitions should be present").not.toBeNull();
    expect(match?.[1]).not.toMatch(
      /\+\s*\d+\s*%|\b\d+\s*%|99\.9|10×|1000\+|±\s*\d+%|\d+h\/semaine|en \d+ min/i,
    );
    expect(dashboard).toContain("Fonctionnalité principale");
    expect(dashboard).not.toContain("ROI estimé')}</div>");
  });
});
