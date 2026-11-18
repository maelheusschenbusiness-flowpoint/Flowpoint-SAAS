// Run (from the Flowpoint Site app root): npx tsx docs/site-marketing/tests/signup-url.test.ts
import assert from "node:assert/strict";
import {
  SIGNUP_URL,
  addSellerRefToAppUrl,
  normalizeSellerRef,
  readSellerRefFromSearch,
  signupUrlForPlan,
} from "../../../client/src/lib/signup-url";

// 1. one link per card, nothing else changes
assert.equal(signupUrlForPlan("standard"), `${SIGNUP_URL}?plan=standard`);
assert.equal(signupUrlForPlan("pro"), `${SIGNUP_URL}?plan=pro`);
assert.equal(signupUrlForPlan("Ultra"), `${SIGNUP_URL}?plan=ultra`);
// 2. unknown values never reach the SaaS
for (const bad of ["gold", "", " ", null, undefined, "pro&x=1", "pro/../"]) {
  assert.equal(signupUrlForPlan(bad as string | null | undefined), SIGNUP_URL);
}
// 3. seller code: strict format, alias ref, case-insensitive
assert.equal(normalizeSellerRef("seller-ab12"), "SELLER-AB12");
assert.equal(normalizeSellerRef("SELLER-"), null);
assert.equal(normalizeSellerRef("<script>"), null);
assert.equal(normalizeSellerRef("SELLER-" + "A".repeat(21)), null);
assert.equal(readSellerRefFromSearch("?utm_source=x&fp_ref=SELLER-X1"), "SELLER-X1");
assert.equal(readSellerRefFromSearch("?ref=seller-x1"), "SELLER-X1");
assert.equal(readSellerRefFromSearch("?fp_ref=nope"), null);
// 4. fp_ref is added without dropping plan / attribution; other origins untouched
const withPlan = `${SIGNUP_URL}?plan=pro&fp_vid=abc&utm_source=g&fp_lid=${"A".repeat(22)}`;
const out = new URL(addSellerRefToAppUrl(withPlan, "SELLER-X1"));
assert.equal(out.searchParams.get("plan"), "pro");
assert.equal(out.searchParams.get("fp_vid"), "abc");
assert.equal(out.searchParams.get("utm_source"), "g");
assert.equal(out.searchParams.get("fp_lid"), "A".repeat(22));
assert.equal(out.searchParams.get("fp_ref"), "SELLER-X1");
assert.equal(addSellerRefToAppUrl("https://evil.example/x", "SELLER-X1"), "https://evil.example/x");
assert.equal(addSellerRefToAppUrl(withPlan, null), withPlan);

// 5. funnel-tracking: referral copied WITHOUT consent, stored ONLY with consent
const store = new Map<string, string>();
let search = "?fp_ref=SELLER-Z9";
(globalThis as any).window = {
  get location() { return { search, hostname: "flowpoint.pro", protocol: "https:" }; },
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
const { addSellerRefToSignupLink } = await import("../../../client/src/lib/funnel-tracking");
const a1 = { href: `${SIGNUP_URL}?plan=ultra` } as HTMLAnchorElement;
addSellerRefToSignupLink(a1);
assert.equal(new URL(a1.href).searchParams.get("fp_ref"), "SELLER-Z9");
assert.equal(new URL(a1.href).searchParams.get("plan"), "ultra");
assert.equal(store.size, 0, "no storage without consent");
store.set("cookie_consent", "accepted");
addSellerRefToSignupLink({ href: SIGNUP_URL } as HTMLAnchorElement);
assert.equal(store.get("flowpoint_funnel_seller_ref"), "SELLER-Z9");
search = ""; // next page of the site, no ref in URL
const a2 = { href: SIGNUP_URL } as HTMLAnchorElement;
addSellerRefToSignupLink(a2);
assert.equal(new URL(a2.href).searchParams.get("fp_ref"), "SELLER-Z9");
console.log("signup-url tests: OK");
