import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const authSource = readFileSync(resolve(process.cwd(), "src/routes/auth.ts"), "utf8");

describe("login-verify Stripe mode selection", () => {
  it("passes the environment-aware Stripe key to Customer resolution", () => {
    const marker = "// Fire-and-forget: ensure Stripe customer";
    const start = authSource.indexOf(marker);
    const block = authSource.slice(start, start + 1_500);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("const stripeKey = getStripeKey()");
    expect(block).toContain("ensureStripeCustomer(sessionOrgId, undefined, stripeKey)");
    expect(block).not.toContain("STRIPE_LIVE_API_KEY");
  });
});