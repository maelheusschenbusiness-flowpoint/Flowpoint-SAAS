import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkoutIdempotencyKey, describeStripeFailure, stripeFailureLogFields } from "../routes/public-billing.js";

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

describe("idempotency — dedup a technical retry, never block a real one", () => {
  const attempt = {
    scope: "payment_intent",
    actor: "pre_tok_abc",
    plan: "standard",
    addons: { monitors: 2 },
    amountCents: 4900,
    now: 1_700_000_000_000,
  };

  it("same request retry → same operation", () => {
    // The double click, and the network retry a second later.
    expect(checkoutIdempotencyKey(attempt)).toBe(checkoutIdempotencyKey(attempt));
    expect(checkoutIdempotencyKey({ ...attempt, now: attempt.now + 3_000 }))
      .toBe(checkoutIdempotencyKey(attempt));
  });

  it("failed payment → legitimate retry possible", () => {
    // Within the window the PaymentIntent is reused on purpose: a declined PI
    // goes back to requires_payment_method and is confirmable with the new card.
    expect(checkoutIdempotencyKey({ ...attempt, now: attempt.now + 60_000 }))
      .toBe(checkoutIdempotencyKey(attempt));
    // Past the window the prospect gets a fresh object, so a single-use Checkout
    // Session that has since expired can never strand them on a dead URL.
    expect(checkoutIdempotencyKey({ ...attempt, now: attempt.now + 11 * 60_000 }))
      .not.toBe(checkoutIdempotencyKey(attempt));
  });

  it("different amount → different operation", () => {
    expect(checkoutIdempotencyKey({ ...attempt, amountCents: 9900 }))
      .not.toBe(checkoutIdempotencyKey(attempt));
  });

  it("different plan → different operation", () => {
    expect(checkoutIdempotencyKey({ ...attempt, plan: "pro" }))
      .not.toBe(checkoutIdempotencyKey(attempt));
  });

  it("different cart, different buyer or different operation → different key", () => {
    expect(checkoutIdempotencyKey({ ...attempt, addons: { monitors: 3 } })).not.toBe(checkoutIdempotencyKey(attempt));
    expect(checkoutIdempotencyKey({ ...attempt, addons: {} })).not.toBe(checkoutIdempotencyKey(attempt));
    expect(checkoutIdempotencyKey({ ...attempt, actor: "pre_tok_other" })).not.toBe(checkoutIdempotencyKey(attempt));
    expect(checkoutIdempotencyKey({ ...attempt, scope: "setup_intent" })).not.toBe(checkoutIdempotencyKey(attempt));
  });

  it("the order add-ons were typed in is not part of the cart", () => {
    const a = checkoutIdempotencyKey({ ...attempt, addons: { monitors: 2, seats: 1 } });
    const b = checkoutIdempotencyKey({ ...attempt, addons: { seats: 1, monitors: 2 } });
    expect(a).toBe(b);
  });

  it("is a Stripe-safe opaque key, not something readable", () => {
    const key = checkoutIdempotencyKey(attempt);
    expect(key).toMatch(/^fp_[0-9a-f]{48}$/);
    expect(key).not.toContain("pre_tok_abc");
  });
});

describe("nothing arbitrary reaches the browser", () => {
  it("only the vetted decline reasons are reflected", () => {
    expect(describeStripeFailure({ type: "StripeCardError", decline_code: "insufficient_funds" }).code)
      .toBe("card_declined:insufficient_funds");
    // Unvetted, attacker-shaped, or non-string reasons degrade to the plain code.
    for (const decline of ["<script>alert(1)</script>", "cus_1234567890", "totally_new_stripe_code", 42, null, undefined, { a: 1 }]) {
      expect(describeStripeFailure({ type: "StripeCardError", decline_code: decline }).code).toBe("card_declined");
    }
  });

  it("the message is always one of the allowlisted literals", () => {
    const allowed = new Set([
      "Votre carte a été refusée. Vérifiez vos informations ou utilisez un autre moyen de paiement.",
      "Service de paiement momentanément saturé. Réessayez dans quelques instants.",
      "Service de paiement momentanément indisponible. Réessayez dans quelques instants.",
      "Cette tentative de paiement a changé en cours de route. Rechargez la page et recommencez.",
      "Cette demande de paiement est invalide. Rechargez la page et recommencez.",
      "Erreur lors de la création du paiement.",
    ]);
    const probes: unknown[] = [
      { type: "StripeCardError", message: "cus_42 raw", raw: { secret: "sk_live_x" } },
      { type: "StripeRateLimitError" },
      { type: "StripeConnectionError" },
      { type: "StripeAPIError" },
      { type: "StripeIdempotencyError" },
      { type: "StripeInvalidRequestError" },
      { type: "StripeUnknownFutureError" },
      new Error("stack-bearing failure"),
      "a bare string",
      null,
      undefined,
    ];
    for (const probe of probes) {
      const view = describeStripeFailure(probe);
      expect(allowed.has(view.error)).toBe(true);
      expect(view.code).toMatch(/^[a-z_]+(:[a-z_]+)?$/);
    }
  });

  it("an unknown error class gets the generic answer, not its own detail", () => {
    const view = describeStripeFailure({ type: "StripeSomethingNew", message: "internal detail", stack: "at foo()" });
    expect(view.status).toBe(500);
    expect(view.error).toBe("Erreur lors de la création du paiement.");
    expect(JSON.stringify(view)).not.toContain("internal detail");
    expect(JSON.stringify(view)).not.toContain("at foo()");
  });

  it("mutating one response cannot poison the next", () => {
    const first = describeStripeFailure({ type: "StripeCardError" });
    first.error = "tampered";
    expect(describeStripeFailure({ type: "StripeCardError" }).error).not.toBe("tampered");
  });
});

describe("logs carry diagnosis, not cardholder data", () => {
  it("keeps only the curated provider fields", () => {
    const fields = stripeFailureLogFields({
      type: "StripeCardError",
      code: "card_declined",
      decline_code: "lost_card",
      requestId: "req_123",
      statusCode: 402,
      message: "Your card was declined",
      payment_method: { card: { last4: "4242", fingerprint: "fp_abc" } },
      customer: "cus_123",
      raw: { secret: "sk_live_should_never_be_logged" },
    });
    expect(Object.keys(fields).sort()).toEqual([
      "stripeCode", "stripeDeclineCode", "stripeRequestId", "stripeStatusCode", "stripeType",
    ]);
    const serialised = JSON.stringify(fields);
    for (const forbidden of ["4242", "fp_abc", "cus_123", "sk_live", "Your card was declined"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("never throws on a malformed error", () => {
    expect(() => stripeFailureLogFields(null)).not.toThrow();
    expect(() => stripeFailureLogFields("nope")).not.toThrow();
    expect(stripeFailureLogFields({}).stripeType).toBe("");
  });

  it("the route no longer logs the raw error object", () => {
    expect(billingSrc).not.toMatch(/logger\.error\(\{ err, code: failure\.code \}/);
    expect(billingSrc).toMatch(/stripeFailureLogFields\(err\)/);
  });
});
