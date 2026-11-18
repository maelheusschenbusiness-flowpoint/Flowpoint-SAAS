// Run in the SaaS repo, on the branch where signin-plan-param.patch is applied:
//   node docs/site-marketing/tests/saas-signin-plan-param.check.mjs artifacts/flowpoint-export/signin.html
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
const html = readFileSync(process.argv[2], "utf8");
const start = html.indexOf("(function () {\n    if (googleSignupParam === '1') return;");
assert.ok(start > -1, "plan block not found");
const block = html.slice(start, html.indexOf("})();", start) + 5);
function run(search, googleSignup = null, cart = null) {
  const store = new Map(cart ? [["fp_cart", JSON.stringify(cart)]] : []);
  runInNewContext(block, {
    googleSignupParam: googleSignup, urlParams: new URLSearchParams(search),
    FP_PLANS: ["standard", "pro", "ultra"], JSON, Date, String,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  return store.has("fp_cart") ? JSON.parse(store.get("fp_cart")) : null;
}
assert.equal(run("?plan=pro").plan, "pro");
assert.equal(run("?plan=ULTRA&fp_vid=x").plan, "ultra");
assert.equal(run("?plan=gold"), null);
assert.equal(run("?plan=pro%26x"), null);
assert.equal(run(""), null);
assert.equal(run("?plan=pro", "1"), null, "ignored on the Google callback");
const c = run("?plan=standard", null, { plan: "pro", addons: { a: 1 }, _v: 1 });
assert.equal(c.plan, "standard"); assert.deepEqual(c.addons, { a: 1 }); assert.ok(Date.now() - c._updatedAt < 2000);
console.log("saas signin ?plan= checks: OK");
