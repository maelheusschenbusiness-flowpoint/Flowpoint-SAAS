import { describe, expect, it } from "vitest";
import { parseWorkspaceLaunchOutput } from "./workspace-launch-output.js";

function validPayload() {
  return {
    strategy: "Prioriser les pages locales et améliorer les conversions avec des tests mesurables.",
    roadmap: Array.from({ length: 5 }, (_, index) => ({
      priority: index + 1,
      label: `Action ${index + 1}`,
      impact: "Impact à mesurer après mise en œuvre",
      tag: "SEO",
    })).reverse(),
    missions: Array.from({ length: 12 }, (_, index) => ({
      title: `Mission ${index + 1}`,
      category: "seo",
      priority: index + 1,
      impact: "Résultat à mesurer",
      effort: "2h",
    })).reverse(),
  };
}

describe("parseWorkspaceLaunchOutput", () => {
  it("accepts and orders a complete plan with all required fields", () => {
    const result = parseWorkspaceLaunchOutput(JSON.stringify(validPayload()));
    expect(result?.strategy).toContain("Prioriser");
    expect(result?.roadmap.map(step => step.priority)).toEqual([1, 2, 3, 4, 5]);
    expect(result?.missions.map(mission => mission.priority)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("rejects malformed or incomplete model output instead of returning demo content", () => {
    expect(parseWorkspaceLaunchOutput("not-json")).toBeNull();
    const incomplete = validPayload();
    incomplete.missions.pop();
    expect(parseWorkspaceLaunchOutput(JSON.stringify(incomplete))).toBeNull();
  });

  it("rejects duplicate priorities, missing fields, and unsupported categories", () => {
    const duplicate = validPayload();
    duplicate.roadmap[1].priority = 1;
    expect(parseWorkspaceLaunchOutput(JSON.stringify(duplicate))).toBeNull();

    const unsupported = validPayload();
    unsupported.missions[0].category = "made_up";
    expect(parseWorkspaceLaunchOutput(JSON.stringify(unsupported))).toBeNull();

    const missingImpact = validPayload();
    missingImpact.missions[0].impact = " ";
    expect(parseWorkspaceLaunchOutput(JSON.stringify(missingImpact))).toBeNull();
  });
});
