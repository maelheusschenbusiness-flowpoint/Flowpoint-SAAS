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

  it("accepts a strategy wrapped in a ```json code block", () => {
    const strategy = parseContentDecayStrategy(`\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``);
    expect(strategy?.summary).toBe(valid().summary);
    expect(strategy?.actions).toHaveLength(3);
  });

  it("accepts a code block without the json word", () => {
    const strategy = parseContentDecayStrategy(`\`\`\`\n${JSON.stringify(valid())}\n\`\`\``);
    expect(strategy?.actions).toHaveLength(3);
  });

  it("rejects text before the code block", () => {
    const wrapped = `Voici la stratégie :\n\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``;
    expect(parseContentDecayStrategy(wrapped)).toBeNull();
  });

  it("rejects a code block holding invalid JSON", () => {
    expect(parseContentDecayStrategy("```json\nnot-json\n```")).toBeNull();
  });

  it("still accepts a valid strategy without any code block", () => {
    expect(parseContentDecayStrategy(JSON.stringify(valid()))?.summary).toBe(valid().summary);
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
