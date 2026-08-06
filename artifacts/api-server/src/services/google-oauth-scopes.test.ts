import { describe, expect, it } from "vitest";
import {
  GOOGLE_INTEGRATION_SCOPES,
  GOOGLE_INTEGRATION_SCOPE_SET,
  generateAuthUrl,
} from "./google-service.js";

const forbiddenAnalyticsScope = [
  "https://www.googleapis.com/auth/analytics",
  ".edit",
].join("");

function decodedScopes(url: string): string[] {
  const scopes = new URL(url).searchParams.get("scope");
  expect(scopes).toBeTruthy();
  return scopes!.split(/\s+/).filter(Boolean);
}

describe("Google integration OAuth scope allowlist", () => {
  it("generates exactly the canonical integration scopes", () => {
    const scopes = decodedScopes(generateAuthUrl("test-state"));

    expect(scopes).toEqual([...GOOGLE_INTEGRATION_SCOPES]);
    expect(new Set(scopes)).toEqual(GOOGLE_INTEGRATION_SCOPE_SET);
    expect(scopes).toContain("https://www.googleapis.com/auth/analytics.readonly");
    expect(scopes).not.toContain(forbiddenAnalyticsScope);
  });

  it("rejects unknown or broader scopes", () => {
    const scopes = decodedScopes(generateAuthUrl("test-state"));
    expect(scopes.every((scope) => GOOGLE_INTEGRATION_SCOPE_SET.has(scope))).toBe(true);
  });
});