import { describe, it, expect } from "vitest";
import { CARRIED_PARAMS, carriedParams, withCarriedParams } from "./carry-params.js";

describe("carry-params — what survives a funnel hop", () => {
  it("carries the attribution a prospect arrived with", () => {
    expect(withCarriedParams("/signin.html", { fp_ref: "SELLER-AB12" }))
      .toBe("/signin.html?fp_ref=SELLER-AB12");
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
      redirect_to: "https://evil.example/steal",
      next: "//evil.example",
      token: "abc",
    });
    expect(out).toEqual({ fp_ref: "SELLER-AB12" });
    expect(CARRIED_PARAMS).not.toContain("redirect_to");
  });

  it("drops values that cannot be ours", () => {
    // Array (?plan=a&plan=b), too long, or carrying structure.
    expect(carriedParams({ plan: ["a", "b"] })).toEqual({});
    expect(carriedParams({ fp_ref: "x".repeat(129) })).toEqual({});
    expect(carriedParams({ fp_ref: "a b" })).toEqual({});
    expect(carriedParams({ fp_ref: "https://evil.example" })).toEqual({});
    expect(carriedParams({ fp_ref: "" })).toEqual({});
  });
});
