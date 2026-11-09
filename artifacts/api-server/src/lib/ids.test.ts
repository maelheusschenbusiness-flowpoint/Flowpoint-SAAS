import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newId } from "./ids.js";

describe("newId", () => {
  it("produit un prefixe + UUID v4 non previsible et unique", () => {
    const a = newId("gp"), b = newId("gp");
    expect(a).toMatch(/^gp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
  it.each([
    "../services/gbp-posting-service.ts", "../services/local-maps-service.ts",
    "../services/alert-events-service.ts", "../routes/alert-rules.ts",
  ])("%s ne genere plus d'identifiant par Date.now()+Math.random()", file => {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\.now\(\)\}_\$\{Math\.random\(\)/);
  });
});
