import { describe, expect, it } from "vitest";
import {
  classifyStripeRetrieveError, isWellFormedCheckoutSessionId, resolveVerifiedPlan, sessionBelongsToOrg,
} from "./billing-verify-guards.js";

describe("sessionBelongsToOrg", () => {
  it("customer identique : oui ; customer different : non", () => {
    expect(sessionBelongsToOrg({ customer: "cus_1" }, "o", "cus_1")).toBe(true);
    expect(sessionBelongsToOrg({ customer: "cus_2" }, "o", "cus_1")).toBe(false);
  });
  it("customer etendu (objet) accepte", () => {
    expect(sessionBelongsToOrg({ customer: { id: "cus_1" } }, "o", "cus_1")).toBe(true);
  });
  it("orgId / client_reference_id : correspondance ou conflit", () => {
    expect(sessionBelongsToOrg({ metadata: { orgId: "o" } }, "o", null)).toBe(true);
    expect(sessionBelongsToOrg({ client_reference_id: "o" }, "o", null)).toBe(true);
    expect(sessionBelongsToOrg({ client_reference_id: "x", customer: "cus_1" }, "o", "cus_1")).toBe(false);
    expect(sessionBelongsToOrg({ metadata: { orgId: "x" } }, "o", null)).toBe(false);
  });
  it("aucun lien : refuse (echec ferme)", () => {
    expect(sessionBelongsToOrg({}, "o", null)).toBe(false);
    expect(sessionBelongsToOrg({ customer: "cus_1" }, "o", null)).toBe(false);
  });
});

describe("classifyStripeRetrieveError", () => {
  it("introuvable -> 404, indisponible -> 502/503, inconnu -> 500", () => {
    expect(classifyStripeRetrieveError({ type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 }).status).toBe(404);
    expect(classifyStripeRetrieveError({ type: "StripeConnectionError" }).status).toBe(503);
    expect(classifyStripeRetrieveError({ type: "StripeRateLimitError", statusCode: 429 }).status).toBe(503);
    expect(classifyStripeRetrieveError({ type: "StripeAPIError", statusCode: 500 }).status).toBe(502);
    expect(classifyStripeRetrieveError(new Error("boom")).status).toBe(500);
  });
});

describe("resolveVerifiedPlan / id", () => {
  it("pas de defaut", () => {
    expect(resolveVerifiedPlan({})).toBeNull();
    expect(resolveVerifiedPlan({ plan: "x" })).toBeNull();
    expect(resolveVerifiedPlan({ selected_plan: "ULTRA", plan: "pro" })).toBe("ultra");
  });
  it("forme de l'identifiant", () => {
    expect(isWellFormedCheckoutSessionId("cs_test_a1B2c3")).toBe(true);
    expect(isWellFormedCheckoutSessionId("../x")).toBe(false);
    expect(isWellFormedCheckoutSessionId("cus_123")).toBe(false);
  });
});
