import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = process.cwd();
const dashboardSource = readFileSync(resolve(apiRoot, "../../src/frontend/dashboard.js"), "utf8");
const dashboardExport = readFileSync(resolve(apiRoot, "../flowpoint-export/dashboard.js"), "utf8");

function extractFunction(name: string): string {
  const start = dashboardSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < dashboardSource.length; i += 1) {
    if (dashboardSource[i] === "{") {
      depth += 1;
      opened = true;
    } else if (dashboardSource[i] === "}") {
      depth -= 1;
      if (opened && depth === 0) return dashboardSource.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated ${name}`);
}

const planLabelSource = extractFunction("fpPlanLabel");
const successMessageSource = extractFunction("fpPlanChangeSuccessMessage");
const markActionSource = extractFunction("fpMarkPlanChangeAction");
const recentActionSource = extractFunction("fpHasRecentPlanChangeAction");
const getSuccessMessage = new Function(
  `${planLabelSource}\n${successMessageSource}\nreturn fpPlanChangeSuccessMessage;`,
)() as (plan: string, reactivated?: boolean) => string;

function createActionHarness() {
  const fakeWindow: { _fpPlanUpgradeRecord?: unknown } = {};
  return new Function(
    "window",
    `${markActionSource}\n${recentActionSource}\nreturn { mark: fpMarkPlanChangeAction, recent: fpHasRecentPlanChangeAction };`,
  )(fakeWindow) as {
    mark: (plan: string) => void;
    recent: (plan?: string) => boolean;
  };
}

describe("dashboard plan-change notifications", () => {
  it.each([
    ["standard", "Vous êtes passé au plan Standard."],
    ["pro", "Vous êtes passé au plan Pro."],
    ["ultra", "Vous êtes passé au plan Ultra."],
  ])("names the target %s plan", (plan, expected) => {
    expect(getSuccessMessage(plan)).toBe(expected);
  });

  it("uses subscription wording for a reactivation", () => {
    expect(getSuccessMessage("pro", true)).toBe(
      "Votre abonnement est maintenant sur le plan Pro.",
    );
  });

  it("records a typed plan_change action in every upgrade implementation", () => {
    expect(dashboardSource).toContain("actionType: 'plan_change'");
    expect((dashboardSource.match(/fpMarkPlanChangeAction\(plan\);/g) || []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it("recognizes only the matching typed plan-change window", () => {
    const action = createActionHarness();
    action.mark("ultra");
    expect(action.recent()).toBe(true);
    expect(action.recent("ultra")).toBe(true);
    expect(action.recent("pro")).toBe(false);
  });

  it("suppresses add-on toasts only during a recent typed plan change", () => {
    expect((dashboardSource.match(/if \(!fpHasRecentPlanChangeAction\(\)\)/g) || []).length)
      .toBeGreaterThanOrEqual(2);
    expect(dashboardSource).toContain("showToast('success', fpT('Add-on activé ✓'))");
  });

  it("keeps production export synchronized", () => {
    expect(dashboardExport).toBe(dashboardSource);
  });
});