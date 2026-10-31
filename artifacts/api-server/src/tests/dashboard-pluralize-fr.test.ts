import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.js"),
  "utf8",
);

function extractFunction(startMarker: string, endMarker: string): string {
  const start = dashboardSource.indexOf(startMarker);
  expect(start, `missing dashboard function: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = dashboardSource.indexOf(endMarker, start);
  expect(end, `missing function terminator for: ${startMarker}`).toBeGreaterThan(start);
  return dashboardSource.slice(start, end + endMarker.length);
}

const pluralizeFrSource = extractFunction("function pluralizeFr(n, sg, pl) {", "\n}");

type PluralizeFr = (n: unknown, sg: string, pl?: string) => string;

function loadPluralizeFr(): PluralizeFr {
  const context: Record<string, unknown> = {};
  runInNewContext(`${pluralizeFrSource}\nthis.pluralizeFr = pluralizeFr;`, context);
  return context.pluralizeFr as PluralizeFr;
}

const pluralizeFr = loadPluralizeFr();

describe("dashboard pluralizeFr", () => {
  it("keeps the source and served dashboard copies identical", () => {
    const sourceCopy = readFileSync(
      resolve(process.cwd(), "../../src/frontend/dashboard.js"),
      "utf8",
    );
    expect(sourceCopy).toBe(dashboardSource);
  });

  it("stays a top-level function declaration with the same signature", () => {
    expect(dashboardSource).toContain("\nfunction pluralizeFr(n, sg, pl) {");
  });

  it("uses the singular below two in absolute value", () => {
    expect(pluralizeFr(0, "règle")).toBe("règle");
    expect(pluralizeFr(1, "règle")).toBe("règle");
    expect(pluralizeFr(1.5, "règle")).toBe("règle");
    expect(pluralizeFr(-1, "règle")).toBe("règle");
    expect(pluralizeFr(0, "critique", "critiques")).toBe("critique");
  });

  it("treats a number received as a string like the number itself", () => {
    expect(pluralizeFr("1", "règle")).toBe("règle");
    expect(pluralizeFr("0", "règle")).toBe("règle");
    expect(pluralizeFr("1.5", "règle")).toBe("règle");
    expect(pluralizeFr("2", "règle")).toBe("règles");
    expect(pluralizeFr("12", "événement", "événements")).toBe("événements");
  });

  it("uses the plural from two upwards", () => {
    expect(pluralizeFr(2, "règle")).toBe("règles");
    expect(pluralizeFr(3, "règle")).toBe("règles");
    expect(pluralizeFr(-2, "règle")).toBe("règles");
    expect(pluralizeFr(10, "événement", "événements")).toBe("événements");
  });

  it("falls back to the plural for missing or non-numeric values", () => {
    expect(pluralizeFr(null, "règle")).toBe("règles");
    expect(pluralizeFr(undefined, "règle")).toBe("règles");
    expect(pluralizeFr("", "règle")).toBe("règles");
    expect(pluralizeFr("abc", "règle")).toBe("règles");
    expect(pluralizeFr(Number.NaN, "règle")).toBe("règles");
    expect(pluralizeFr(Number.POSITIVE_INFINITY, "règle")).toBe("règles");
    expect(pluralizeFr(null, "critique", "critiques")).toBe("critiques");
  });

  it("derives the plural by appending an s when no plural form is given", () => {
    expect(pluralizeFr(2, "règle")).toBe("règle" + "s");
    expect(pluralizeFr(5, "audit")).toBe("audits");
  });
});
