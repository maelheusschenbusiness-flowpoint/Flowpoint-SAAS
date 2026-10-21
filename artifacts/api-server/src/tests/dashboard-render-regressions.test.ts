import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "../../src/frontend/dashboard.js"),
  "utf8",
);
const exported = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.js"),
  "utf8",
);

describe("dashboard render regressions", () => {
  it("keeps the served dashboard source and export identical", () => {
    expect(exported).toBe(source);
  });

  it("derives local SEO zone counts from optional real zone data", () => {
    const start = source.indexOf("function renderLocalSEO()");
    const end = source.indexOf("/* ──", start + 1);
    const localSeo = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(localSeo).toMatch(/const _zones = Array\.isArray\(_lseo\.zones\)/);
    expect(localSeo).toMatch(/const totalZones = _zones\.length/);
    expect(localSeo).toMatch(/const dominatedZones = totalZones > 0/);
  });

  it("renders profile initials when the account has no first name", () => {
    expect(source).toContain("String(me.firstName || me.email || 'U').charAt(0)");
  });
});
