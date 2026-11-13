import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkoutPaymentHtml = readFileSync(
  new URL("../../../flowpoint-export/checkout-payment.html", import.meta.url),
  "utf8",
);
const checkoutAbandonmentSpec = readFileSync(
  new URL("../../../../e2e/parcours/checkout-abandonment.spec.mjs", import.meta.url),
  "utf8",
);

describe("checkout Payment Element return URL contract", () => {
  it("uses the current origin for both PaymentIntent and SetupIntent confirmations", () => {
    expect(checkoutPaymentHtml).toMatch(
      /var returnUrl\s*=\s*window\.location\.origin\s*\+\s*['"]\/checkout-return\.html['"]/,
    );
    expect(checkoutPaymentHtml).toMatch(
      /stripe\.confirmPayment\(\{[\s\S]{0,220}confirmParams:\s*\{\s*return_url:\s*returnUrl\s*\}/,
    );
    expect(checkoutPaymentHtml).toMatch(
      /stripe\.confirmSetup\(\{[\s\S]{0,220}confirmParams:\s*\{\s*return_url:\s*returnUrl\s*\}/,
    );
  });

  it("gives direct TEST SetupIntent confirmation a local return URL", () => {
    expect(checkoutAbandonmentSpec).toContain(
      'const checkoutReturnUrl = new URL("/checkout-return.html", BASE_URL).toString();',
    );
    expect(checkoutAbandonmentSpec).toContain("Checkout E2E refuses non-local return URLs.");
    expect(checkoutAbandonmentSpec).toMatch(
      /stripe\.setupIntents\.confirm\(setup\.setupIntentId,\s*\{[\s\S]{0,160}return_url:\s*checkoutReturnUrl/,
    );
  });

  it("prefills the billing country supplied by signup into the Payment Element", () => {
    expect(checkoutPaymentHtml).toMatch(
      /_bd\.address\s*=\s*\{\s*country:\s*_dv\.country\s*\}/,
    );
  });
});
