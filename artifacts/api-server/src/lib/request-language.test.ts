import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import {
  normalizeLanguageCode,
  resolveLanguageFromSources,
  resolveOrgLanguage,
  resolveRequestLanguage,
  type LanguageLoaders,
} from "./request-language.js";

const loaders = (user: unknown, org: unknown): LanguageLoaders => ({
  loadUserLanguage: async () => user,
  loadOrgLanguage: async () => org,
});
const fakeReq = (extra: Record<string, unknown> = {}) =>
  ({ orgId: "11111111-1111-1111-1111-111111111111", headers: { "accept-language": "de-DE,de;q=0.9" }, ...extra }) as unknown as Request;

describe("resolveLanguageFromSources", () => {
  it("explicit > user > org > en", () => {
    expect(resolveLanguageFromSources({ explicit: "es", userLanguage: "de", orgLanguage: "it" })).toBe("es");
    expect(resolveLanguageFromSources({ userLanguage: "de", orgLanguage: "it" })).toBe("de");
    expect(resolveLanguageFromSources({ orgLanguage: "it" })).toBe("it");
    expect(resolveLanguageFromSources({})).toBe("en");
  });
  it("ignores the legacy fr org default but keeps an explicit user fr", () => {
    expect(resolveLanguageFromSources({ orgLanguage: "fr" })).toBe("en");
    expect(resolveLanguageFromSources({ orgLanguage: "fr-FR" })).toBe("en");
    expect(resolveLanguageFromSources({ userLanguage: "fr", orgLanguage: "fr" })).toBe("fr");
  });
  it("normalizes and rejects invalid values", () => {
    expect(normalizeLanguageCode("pt-BR")).toBe("pt");
    expect(normalizeLanguageCode("de,en;q=0.5")).toBeNull();
    expect(resolveLanguageFromSources({ explicit: "<script>", userLanguage: "nl" })).toBe("nl");
  });
});

describe("resolveRequestLanguage", () => {
  it("never uses Accept-Language, country or email", async () => {
    const req = fakeReq({ country: "DE", email: "x@example.de", userEmail: "x@example.de" });
    expect(await resolveRequestLanguage(req, { loaders: loaders(null, null) })).toBe("en");
  });
  it("explicit value wins without DB access", async () => {
    const throwing: LanguageLoaders = { loadUserLanguage: async () => { throw new Error("no"); }, loadOrgLanguage: async () => { throw new Error("no"); } };
    expect(await resolveRequestLanguage(fakeReq(), { explicit: "it", loaders: throwing })).toBe("it");
  });
  it("uses user then org preferences", async () => {
    expect(await resolveRequestLanguage(fakeReq(), { loaders: loaders("es", "de") })).toBe("es");
    expect(await resolveRequestLanguage(fakeReq(), { loaders: loaders(null, "de") })).toBe("de");
  });
  it("is fail-safe on DB error → en (never throws)", async () => {
    const throwing: LanguageLoaders = { loadUserLanguage: () => { throw new Error("db down"); }, loadOrgLanguage: async () => { throw new Error("db down"); } };
    expect(await resolveRequestLanguage(fakeReq(), { loaders: throwing })).toBe("en");
    expect(await resolveOrgLanguage("x", throwing)).toBe("en");
  });
  it("caches per request", async () => {
    let calls = 0;
    const l: LanguageLoaders = { loadUserLanguage: async () => { calls++; return "nl"; }, loadOrgLanguage: async () => null };
    const req = fakeReq();
    await resolveRequestLanguage(req, { loaders: l });
    await resolveRequestLanguage(req, { loaders: l });
    expect(calls).toBe(1);
  });
  it("anonymous / default org → en", async () => {
    expect(await resolveRequestLanguage(fakeReq({ orgId: undefined }), { loaders: loaders("de", "de") })).toBe("en");
  });
});

describe("static guards: no browser-derived or hard-coded fr content language", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = ["routes/ai.ts", "routes/pagespeed.ts", "routes/location.ts", "services/local-maps-service.ts"];
  for (const f of files) {
    const code = readFileSync(join(src, f), "utf8");
    it(`${f} does not read the Accept-Language header`, () => {
      expect(code).not.toMatch(/headers\[["']accept-language["']\]/i);
      expect(code).not.toMatch(/\.get\(["']accept-language["']\)/i);
    });
    it(`${f} does not hard-code fr language fallbacks`, () => {
      expect(code).not.toMatch(/accept-language=fr\b/);
      expect(code).not.toMatch(/[&?]language=fr\b/);
      expect(code).not.toMatch(/\|\|\s*["']fr["']\s*\)?\s*\.toLowerCase/);
      expect(code).not.toMatch(/Lang\w*\.trim\(\)\.toLowerCase\(\)(\.slice\(0,\s*2\))?\s*:\s*["']fr["']/);
      expect(code).not.toMatch(/ctx\.language \?\? ["']fr["']/);
      expect(code).not.toMatch(/requestedLanguage = ["']fr["']/);
    });
  }
});
