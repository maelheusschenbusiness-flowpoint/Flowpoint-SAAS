import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeMarketingThemeMode,
  readMarketingThemeCookie,
  resolveMarketingThemeMode,
} from "../shared/marketing-theme";
import { injectMetadata } from "../server/seo-metadata";

const template = readFileSync("client/index.html", "utf8");

test("theme preference accepts only system, light, or dark", () => {
  assert.equal(normalizeMarketingThemeMode(" dark "), "dark");
  assert.equal(normalizeMarketingThemeMode("LIGHT"), "light");
  assert.equal(normalizeMarketingThemeMode("system"), "system");
  assert.equal(normalizeMarketingThemeMode("contrast"), null);
  assert.equal(normalizeMarketingThemeMode(null), null);
});

test("theme preference cookie is parsed safely and defaults to the system", () => {
  assert.equal(readMarketingThemeCookie("session=abc; flowpoint-theme=dark"), "dark");
  assert.equal(readMarketingThemeCookie("flowpoint-theme=%6C%69%67%68%74"), "light");
  assert.equal(readMarketingThemeCookie("flowpoint-theme=dark%ZZ"), null);
  assert.equal(resolveMarketingThemeMode(undefined), "system");
  assert.equal(resolveMarketingThemeMode("flowpoint-theme=invalid"), "system");
});

test("SSR keeps English as the default and includes the saved theme mode", () => {
  const defaultDocument = injectMetadata(template, "/", "fr", "system");
  const savedDarkDocument = injectMetadata(template, "/pricing", "fr", "dark");
  const resourceDocument = injectMetadata(
    template,
    "/resources/seo-guide",
    "fr",
    "light",
  );

  assert.match(defaultDocument, /<html lang="en" data-theme="system">/);
  assert.match(savedDarkDocument, /<html lang="fr" data-theme="dark">/);
  assert.match(resourceDocument, /<html lang="en" data-theme="light">/);
  assert.match(savedDarkDocument, /<title>SEO &amp; Digital Growth Software Pricing/);
  assert.match(savedDarkDocument, /<link rel="canonical" href="https:\/\/flowpoint\.pro\/pricing"/);
});

test("theme bootstrap runs before client hydration and resolves the landing theme", () => {
  const rootPosition = template.indexOf('<div id="root"></div>');
  const themeSyncPosition = template.indexOf('document.querySelector("#root .fp2-page")');
  const clientScriptPosition = template.indexOf('src="/src/main.tsx"');

  assert.ok(rootPosition >= 0);
  assert.ok(themeSyncPosition > rootPosition);
  assert.ok(clientScriptPosition > themeSyncPosition);
  assert.match(template, /prefers-color-scheme: dark/);
  assert.match(template, /data-theme-picker/);
  assert.match(template, /flowpoint-theme=/);
});
