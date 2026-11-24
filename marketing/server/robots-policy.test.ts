import assert from "node:assert/strict";
import test from "node:test";
import { shouldSetNoindex } from "./robots-policy";

test("the production apex is indexable", () => {
  assert.equal(shouldSetNoindex("flowpoint.pro", "production"), false);
});

test("the Render staging host stays noindex and nofollow", () => {
  assert.equal(
    shouldSetNoindex("flowpoint-marketing-staging.onrender.com", "production"),
    true,
  );
});

test("all non-canonical hosts remain noindex in production", () => {
  assert.equal(shouldSetNoindex("www.flowpoint.pro", "production"), true);
  assert.equal(shouldSetNoindex("unknown.onrender.com", "production"), true);
  assert.equal(shouldSetNoindex("flowpoint.pro.", "production"), false);
});

test("non-production environments remain noindex even on the apex host", () => {
  assert.equal(shouldSetNoindex("flowpoint.pro", "development"), true);
});
