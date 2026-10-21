import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
