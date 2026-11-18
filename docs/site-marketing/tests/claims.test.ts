// Run: npx tsx docs/site-marketing/tests/claims.test.ts  (variant A claims, pending owner approval)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const pricing = readFileSync(new URL("../../../client/src/pages/Pricing.tsx", import.meta.url), "utf8");
for (const bad of ["Track 10 keywords", "Unlimited API", "Unlimited AI Missions", "Priority support"]) {
  assert.ok(!pricing.includes(bad), `forbidden promise still present: ${bad}`);
}
for (const ok of ["Track 50 keywords", "Track 500 keywords", "A payment card is required", "signupUrlForPlan(plan.id)"]) {
  assert.ok(pricing.includes(ok), `missing: ${ok}`);
}
assert.ok(!/id: "(standard|pro|ultra)" as const[\s\S]*14 ?€/.test(pricing));
for (const p of ["29", "79", "149"]) assert.ok(pricing.includes(`price: ${p},`), `price ${p} must be unchanged`);
console.log("claims tests: OK");
