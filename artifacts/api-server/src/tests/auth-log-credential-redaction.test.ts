import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceFiles = [
  "src/routes/auth.ts",
  "src/routes/public-billing.ts",
  "src/services/sessions.ts",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

describe("authentication log credential safety", () => {
  it("does not log raw auth/session credentials or their prefixes", () => {
    const source = sourceFiles.join("\n");
    expect(source).not.toMatch(/\b(?:tokenPrefix|cookiePrefix|bearerPrefix)\s*:/);
    expect(source).not.toMatch(/logger\.(?:trace|debug|info|warn|error)\(\s*\{[^}]*\btoken\s*:/s);
    expect(source).not.toMatch(/logger\.(?:trace|debug|info|warn|error)\(\s*\{[^}]*\bsessionId\s*,/s);
  });
});
