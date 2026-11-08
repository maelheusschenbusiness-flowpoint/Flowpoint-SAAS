// Run: npx tsx docs/site-marketing/tests/contact.test.ts (needs the app's server/ folder)
import assert from "node:assert/strict";
const { escapeHtml, parseContactBody } = await import("../../../server/routes");
assert.equal(escapeHtml(`<img src=x onerror="a()">&'`), "&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;");
const ok = parseContactBody({ name: "Ann", email: "ann@example.com", subject: "Hi\r\nBcc: x@y.z", message: "Hello" });
assert.ok(ok.ok && !/[\r\n]/.test(ok.subject));
for (const email of ["a@b", "a b@c.de", '"><script>@x.io', "a@b.c", "x".repeat(400) + "@a.bc"]) {
  assert.equal(parseContactBody({ name: "A", email, subject: "s", message: "m" }).ok, false, email);
}
assert.equal(parseContactBody({ name: "A", email: "a@b.cd", subject: "s", message: "m".repeat(5001) }).ok, false);
assert.equal(parseContactBody(null).ok, false);
console.log("contact tests: OK");
