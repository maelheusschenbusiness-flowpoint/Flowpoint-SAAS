import { describe, expect, it } from "vitest";
import { parseContentDecayStrategy } from "./content-decay-strategy.js";

const valid = () => ({
  summary: "Les clics et la position se sont dégradés entre les deux périodes mesurées.",
  actions: [1, 2, 3].map(n => ({
    title: `Action ${n}`,
    reason: "La recommandation est liée aux métriques GSC observées.",
    validation: "Comparer les clics et la position après une nouvelle période de 28 jours.",
  })),
});

describe("parseContentDecayStrategy", () => {
  it("accepts a complete three-action strategy", () => {
    expect(parseContentDecayStrategy(JSON.stringify(valid()))?.actions).toHaveLength(3);
  });

  it("rejects malformed, incomplete, or duplicate recommendations", () => {
    expect(parseContentDecayStrategy("not-json")).toBeNull();
    const incomplete = valid();
    incomplete.actions.pop();
    expect(parseContentDecayStrategy(JSON.stringify(incomplete))).toBeNull();
    const duplicate = valid();
    duplicate.actions[1].title = duplicate.actions[0].title;
    expect(parseContentDecayStrategy(JSON.stringify(duplicate))).toBeNull();
  });
});
