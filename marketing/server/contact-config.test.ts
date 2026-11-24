import assert from "node:assert/strict";
import test from "node:test";
import { getContactRecipient } from "./contact-config";

test("contact delivery defaults to the support mailbox", () => {
  assert.equal(getContactRecipient(""), "support@flowpoint.pro");
});

test("contact delivery accepts a valid service-specific recipient", () => {
  assert.equal(
    getContactRecipient("  support@flowpoint.pro  "),
    "support@flowpoint.pro",
  );
});

test("contact delivery rejects a malformed configured recipient", () => {
  assert.throws(
    () => getContactRecipient("not-an-email"),
    /CONTACT_TO_EMAIL must be a valid email address/,
  );
});
