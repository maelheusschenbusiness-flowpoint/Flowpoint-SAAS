import { describe, it, expect } from "vitest";
import { CARRIED_PARAMS, carriedParams, withCarriedParams } from "./carry-params.js";

describe("carry-params — what survives a funnel hop", () => {
  it("carries valid funnel IDs, source aliases, UTMs, and the selected plan", () => {
    expect(withCarriedParams("/signin.html", {
      fp_lid: "AbCdEfGhIjKlMnOpQr_-12",
      fp_vid: "123e4567-e89b-42d3-a456-426614174000",
      fp_source: "smartlead",
      fp_src: "smartlead",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "autumn-2026",
      plan: "PRO",
    })).toBe(
      "/signin.html?plan=pro&fp_lid=AbCdEfGhIjKlMnOpQr_-12" +
      "&fp_vid=123e4567-e89b-42d3-a456-426614174000" +
      "&fp_source=smartlead&fp_src=smartlead" +
      "&utm_source=newsletter&utm_medium=email&utm_campaign=autumn-2026",
    );
  });

  it("keeps an existing query string and appends alongside it", () => {
    expect(withCarriedParams("/signin.html?error=google_signup_retry", { fp_ref: "SELLER-AB12" }))
      .toBe("/signin.html?error=google_signup_retry&fp_ref=SELLER-AB12");
  });

  it("never overwrites a parameter the redirect already decided", () => {
    expect(withCarriedParams("/signin.html?plan=pro", { plan: "standard" }))
      .toBe("/signin.html?plan=pro");
  });

  it("returns the target untouched when there is nothing to carry", () => {
    const target = "/login.html?error=access_denied";
    expect(withCarriedParams(target, {})).toBe(target);
    expect(withCarriedParams(target, undefined)).toBe(target);
  });

  it("works on an absolute URL and keeps the fragment last", () => {
    expect(withCarriedParams("https://app.flowpoint.pro/signin.html#form", { fp_ref: "SELLER-X" }))
      .toBe("https://app.flowpoint.pro/signin.html?fp_ref=SELLER-X#form");
  });

  it("forwards only the allowlist, never an arbitrary parameter", () => {
    const out = carriedParams({
      fp_ref: "SELLER-AB12",
      fp_vid: "123e4567-e89b-42d3-a456-426614174000",
      redirect_to: "https://evil.example/steal",
      next: "//evil.example",
      token: "abc",
    });
    expect(out).toEqual({
      fp_ref: "SELLER-AB12",
      fp_vid: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(CARRIED_PARAMS).not.toContain("redirect_to");
  });

  it("drops invalid IDs, sources, UTMs, plans, repeated values, and unsafe text", () => {
    expect(carriedParams({
      fp_lid: "too-short",
      fp_vid: "not-a-visitor-id",
      fp_source: "unknown-source",
      fp_src: "unknown-source",
      utm_source: "has spaces",
      utm_medium: "m".repeat(65),
      utm_campaign: "",
      plan: "enterprise",
      fp_ref: "https://evil.example",
      ref: ["SELLER-A", "SELLER-B"],
    })).toEqual({});

    // Repeated query parameters are ambiguous and must not choose one value.
    expect(carriedParams({ plan: ["pro", "ultra"], fp_vid: ["visitor", "visitor"] })).toEqual({});
    expect(carriedParams({ fp_ref: "x".repeat(129) })).toEqual({});
  });

  it("does not add anything when attribution parameters are absent", () => {
    const target = "/signin.html?error=google_signup_retry";
    expect(carriedParams(undefined)).toEqual({});
    expect(withCarriedParams(target, undefined)).toBe(target);
    expect(withCarriedParams(target, {})).toBe(target);
  });
});
