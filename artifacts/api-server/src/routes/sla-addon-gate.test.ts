import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Better Stack SLA add-on gate", () => {
  it("protects the SLA endpoint without changing monitor reads or purchase availability", () => {
    const source = readFileSync(new URL("./betterstack.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /router\.get\("\/betterstack\/monitors\/:id\/sla",\s*requireAddon\("slaMonitoring",\s*"SLA Monitoring Avancé"\)/
    );
  });
});
