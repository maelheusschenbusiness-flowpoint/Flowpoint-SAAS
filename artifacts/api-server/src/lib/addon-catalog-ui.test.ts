import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  ADDON_DEFINITIONS,
  getAddonAvailability,
  isPlanAllowedAddon,
  PLAN_INCLUDED_ADDONS,
  PROTECTED_ADDON_KEYS,
  REMOVED_ADDONS,
} from "./plans.js";
import plansRouter from "../routes/plans.js";

const dashboardPath = fileURLToPath(
  new URL("../../../../src/frontend/dashboard.js", import.meta.url),
);
const exportPath = fileURLToPath(
  new URL("../../../flowpoint-export/dashboard.js", import.meta.url),
);
const dashboard = readFileSync(dashboardPath, "utf8");
const exportedDashboard = readFileSync(exportPath, "utf8");

function loadPolicy(source: string) {
  const match = source.match(
    /\/\* addon-catalog-policy:start \*\/([\s\S]*?)\/\* addon-catalog-policy:end \*\//,
  );
  if (!match) throw new Error("Add-on catalog policy block is missing");
  return new Function(
    `${match[1]}\nreturn { _fpAddonPurchaseState, _fpAddonAccessLabel };`,
  )() as {
    _fpAddonPurchaseState: (
      addon: Record<string, unknown>,
      plan: string,
      included: boolean,
    ) => string;
    _fpAddonAccessLabel: (state: string) => string;
  };
}

describe("add-on catalogue UI commercial gates", () => {
  const policy = loadPolicy(dashboard);

  it("keeps the served and exported dashboards identical", () => {
    expect(exportedDashboard).toBe(dashboard);
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

  it("keeps the UI button and backend authorization aligned for all 35 non-protected add-ons on all plans", () => {
    const plans = ["standard", "pro", "ultra"] as const;
    const keys = Object.keys(ADDON_DEFINITIONS).filter(
      key => !PROTECTED_ADDON_KEYS.has(key),
    );
    expect(keys).toHaveLength(35);

    for (const key of keys) {
      const removed = REMOVED_ADDONS.has(key);
      const availability = getAddonAvailability(key);
      const sellable = !removed && ["available", "beta"].includes(availability);
      const allowedPlans = sellable
        ? plans.filter(plan => isPlanAllowedAddon(plan, key))
        : [];

      for (const plan of plans) {
        const included = PLAN_INCLUDED_ADDONS[plan]?.has(key) ?? false;
        const catalogEntry = removed
          ? { catalogMissing: true, availability: "", allowedPlans: null }
          : { availability, allowedPlans };
        const uiState = policy._fpAddonPurchaseState(catalogEntry, plan, included);
        const backendCanBill = sellable && !included && isPlanAllowedAddon(plan, key);

        if (availability === "coming_soon") {
          expect(uiState, `${key} UI on ${plan}`).toBe("coming_soon");
        } else if (removed) {
          expect(uiState, `${key} UI on ${plan}`).toBe("catalog_unavailable");
        } else if (included) {
          expect(uiState, `${key} UI on ${plan}`).toBe("included");
        } else {
          expect(uiState === "purchasable", `${key} UI on ${plan}`).toBe(backendCanBill);
        }

        if (sellable && !included) {
          expect(isPlanAllowedAddon(plan, key), `${key} backend on ${plan}`).toBe(true);
        }
      }
    }
  });

  it("publishes the exact 35-key plan matrix consumed by the UI and omits retired offers", async () => {
    const app = express();
    app.use(plansRouter);
    const response = await request(app).get("/plans/catalog").expect(200);
    const entries = new Map<string, {
      availability: string;
      allowedPlans: string[];
    }>(response.body.addons.map((addon: { key: string; availability: string; allowedPlans: string[] }) => [
      addon.key,
      addon,
    ]));
    const plans = ["standard", "pro", "ultra"] as const;
    const keys = Object.keys(ADDON_DEFINITIONS).filter(
      key => !PROTECTED_ADDON_KEYS.has(key),
    );
    expect(keys).toHaveLength(35);
    expect(entries.has("prioritySupport")).toBe(false);

    for (const key of keys) {
      if (REMOVED_ADDONS.has(key)) continue;
      const entry = entries.get(key);
      expect(entry, `${key} should exist in the public catalog`).toBeDefined();
      if (!entry) continue;

      const sellable = ["available", "beta"].includes(entry.availability);
      const includedByPlan = response.body.includedByPlan as Record<string, string[]>;
      for (const plan of plans) {
        const included = includedByPlan[plan]?.includes(key) ?? false;
        const uiState = policy._fpAddonPurchaseState(entry, plan, included);
        const backendCanBill = sellable && !included && isPlanAllowedAddon(plan, key);

        expect(entry.allowedPlans.includes(plan), `${key} catalog on ${plan}`).toBe(
          entry.availability === "coming_soon" ? false : isPlanAllowedAddon(plan, key),
        );
        if (sellable && !included) {
          expect(isPlanAllowedAddon(plan, key), `${key} backend on ${plan}`).toBe(true);
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
