import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeStripeFailure } from "../routes/public-billing.js";

const authSrc = readFileSync(resolve(__dirname, "../routes/auth.ts"), "utf8");
const billingSrc = readFileSync(resolve(__dirname, "../routes/public-billing.ts"), "utf8");

describe("pending signup can be resumed instead of bouncing", () => {
  it("pre-register refuses an existing account only when it is not pending", () => {
    // The dead end: login answered 402 → /signin.html for a pending user, while
    // pre-register answered 409 → /login.html for any users row at all.
    expect(authSrc).toMatch(/_existingStatus\s*!==\s*"pending"/);
    expect(authSrc).not.toMatch(/if \(_activeUser\.rows\.length > 0\) \{\s*\n\s*res\.status\(409\)/);
  });

  it("still refuses an account that really exists", () => {
    // active / suspended must keep getting 409 → /login.html.
    const guard = authSrc.slice(authSrc.indexOf("_existingStatus"), authSrc.indexOf("_existingStatus") + 600);
    expect(guard).toContain("409");
    expect(guard).toContain("/login.html");
  });

  it("the login refusal tells the caller the signup is resumable", () => {
    expect(authSrc).toMatch(/code:\s*"SIGNUP_PENDING"/);
    expect(authSrc).toMatch(/resumable:\s*true/);
  });

  it("leaves the invited-team-member guard untouched", () => {
    expect(authSrc).toMatch(/Cette adresse est déjà associée à une organisation FlowPoint/);
  });
});

describe("public checkout is limited per prospect, not globally", () => {
  it("no longer keys the public limiter on an org bucket", () => {
    expect(billingSrc).not.toMatch(/createRateLimit\("reportsPerHour"\)/);
    expect(billingSrc).toMatch(/import \{ publicCheckoutRateLimit \}/);
  });
});

describe("Stripe calls are idempotent", () => {
  it("every create call in the public funnel carries an idempotency key", () => {
    // 3 checkout sessions + PaymentIntent + SetupIntent.
    const keyed = billingSrc.match(/idempotencyKey: checkoutIdempotencyKey/g) ?? [];
    expect(keyed.length).toBe(5);
    expect(billingSrc).not.toMatch(/await stripe\.checkout\.sessions\.create\(sessionParams\);/);
  });

  it("the key follows the cart, so a changed cart is a new attempt", () => {
    const fn = billingSrc.slice(
      billingSrc.indexOf("function checkoutIdempotencyKey"),
      billingSrc.indexOf("function checkoutIdempotencyKey") + 900,
    );
    for (const part of ["scope", "actor", "plan", "addonFingerprint", "amountCents"]) {
      expect(fn).toContain(part);
    }
    // Addon order must not change the key.
    expect(fn).toContain(".sort()");
  });
});

describe("checkout failures are actionable", () => {
  it("a declined card is the caller's problem, not a 500", () => {
    const declined = describeStripeFailure({ type: "StripeCardError", decline_code: "insufficient_funds" });
    expect(declined.status).toBe(402);
    expect(declined.code).toBe("card_declined:insufficient_funds");
    expect(declined.retryable).toBe(true);
  });

  it("a provider outage is reported as temporary", () => {
    expect(describeStripeFailure({ type: "StripeConnectionError" }).status).toBe(503);
    expect(describeStripeFailure({ type: "StripeRateLimitError" }).status).toBe(503);
  });

  it("a bad request is 400 and not worth retrying", () => {
    const invalid = describeStripeFailure({ type: "StripeInvalidRequestError" });
    expect(invalid.status).toBe(400);
    expect(invalid.retryable).toBe(false);
  });

  it("an idempotency conflict asks for a clean reload", () => {
    expect(describeStripeFailure({ type: "StripeIdempotencyError" }).status).toBe(409);
  });

  it("anything unknown stays a 500 with the original message", () => {
    const unknown = describeStripeFailure(new Error("boom"));
    expect(unknown.status).toBe(500);
    expect(unknown.error).toBe("Erreur lors de la création du paiement.");
  });

  it("never leaks a Stripe internal into the user-facing message", () => {
    const leak = describeStripeFailure({ type: "StripeCardError", message: "cus_123 raw stripe detail" });
    expect(leak.error).not.toContain("cus_123");
    expect(leak.error).not.toContain("stripe");
  });
});

describe("the economics of the checkout are untouched", () => {
  it("the trial still comes from the quote, never hardcoded", () => {
    expect(billingSrc).toMatch(/trial_period_days: quote\.trialDays/);
    expect(billingSrc).toMatch(/quote\.trialEligible \?/);
  });

  it("no price or plan id was changed in this PR", () => {
    expect(billingSrc).toMatch(/quoteToStripeLineItems\(quote\)/);
  });
});
