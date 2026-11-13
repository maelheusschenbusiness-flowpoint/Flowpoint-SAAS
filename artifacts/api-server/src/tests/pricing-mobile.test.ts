import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PRICING = readFileSync(join(process.cwd(), "../flowpoint-export/pricing.html"), "utf8");

describe("pricing.html — mobile", () => {
  it("porte les cibles tactiles à 44 px dans le point de rupture mobile uniquement", () => {
    const m = PRICING.match(/@media \(max-width: 600px\) \{[\s\S]*?\n    \}/);
    expect(m).not.toBeNull();
    for (const sel of [".fp-nav-cta", ".fp-card-more-btn", ".fp-addon-btn", ".fp-addon-qty-btn"]) {
      expect(m![0]).toContain(sel);
    }
    expect(m![0]).toMatch(/min-height: 44px/);
  });
  it("centre la carte mise en avant au chargement sur petit écran, sans scroll vertical", () => {
    const block = PRICING.slice(PRICING.indexOf("function centerFeatured()") - 20, PRICING.indexOf("function centerFeatured()") + 900);
    expect(block).toContain("(max-width: 600px)");
    expect(block).toContain(".fp-card.featured");
    expect(block).toContain("grid.scrollLeft +=");
    expect(block).not.toMatch(/scrollIntoView|window\.scrollTo/);
  });
});
