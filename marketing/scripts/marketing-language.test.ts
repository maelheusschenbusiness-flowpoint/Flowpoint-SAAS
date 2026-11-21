import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarketingLanguage } from "../shared/marketing-language";

test("explicit supported query language overrides the displayed-language cookie", () => {
  assert.equal(resolveMarketingLanguage("?lang=fr", "googtrans=/en/en"), "fr");
});

test("a supported displayed-language cookie is used when the query has no language", () => {
  assert.equal(resolveMarketingLanguage("", "googtrans=/en/fr"), "fr");
});

test("unsupported query and cookie languages fall back to English", () => {
  assert.equal(resolveMarketingLanguage("?lang=xx", "googtrans=/en/xx"), "en");
});

test("unsupported query language falls through to a supported French cookie", () => {
  assert.equal(resolveMarketingLanguage("?lang=xx", "googtrans=/en/fr"), "fr");
});
