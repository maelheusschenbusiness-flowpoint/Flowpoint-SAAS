/**
 * Regression tests — visite guidée onboarding
 *
 * Covers three issues:
 * 1. openOnboardingManually must be assigned to window (not just a local IIFE function)
 *    so inline onclick="openOnboardingManually()" in injected HTML resolves.
 * 2. The replay button must NOT call /api/onboarding/complete (no backend mutation).
 * 3. The Visite guidée card in Settings must have margin-top for visual separation.
 * 4. FP_ONBOARDING_STEPS has exactly 4 steps.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(process.cwd(), "../../src/frontend");
const exportRoot   = resolve(process.cwd(), "../flowpoint-export");

const dashSrc  = readFileSync(resolve(frontendRoot, "dashboard.js"), "utf8");
const dashExp  = readFileSync(resolve(exportRoot,   "dashboard.js"), "utf8");

// Helper: run assertions on both source and export mirror.
function bothFiles(fn: (src: string, label: string) => void) {
  fn(dashSrc,  "src/frontend/dashboard.js");
  fn(dashExp,  "artifacts/flowpoint-export/dashboard.js");
}

describe("onboarding replay button — global scope", () => {

  it("openOnboardingManually is assigned to window (both files)", () => {
    bothFiles((src, label) => {
      expect(src, label).toMatch(/window\.openOnboardingManually\s*=/);
    });
  });

  it("Settings button onclick attribute references openOnboardingManually (both files)", () => {
    bothFiles((src, label) => {
      expect(src, label).toContain('onclick="openOnboardingManually()"');
    });
  });

  it("openOnboardingManually does NOT call /api/onboarding/complete (pure UI replay)", () => {
    // The manual replay must never mark onboarding as completed on the server.
    // _fpCloseOnboarding(true) contains that POST — openOnboardingManually must NOT call it.
    bothFiles((src, label) => {
      // Find the body of openOnboardingManually and verify no POST to /api/onboarding/complete.
      const fnStart = src.indexOf("window.openOnboardingManually");
      expect(fnStart, `${label}: function not found`).toBeGreaterThanOrEqual(0);
      // Grab the 400 chars after the function start — covers the function body.
      const fnBody = src.slice(fnStart, fnStart + 400);
      expect(fnBody, label).not.toContain("/api/onboarding/complete");
      expect(fnBody, label).not.toContain("_fpCloseOnboarding");
    });
  });

  it("openOnboardingManually resets step index to 0 (starts at step 1/4)", () => {
    bothFiles((src, label) => {
      const fnStart = src.indexOf("window.openOnboardingManually");
      const fnBody  = src.slice(fnStart, fnStart + 400);
      expect(fnBody, label).toContain("_fpOnboardingStepIdx = 0");
    });
  });

  it("openOnboardingManually renders and shows the overlay (both files)", () => {
    bothFiles((src, label) => {
      const fnStart = src.indexOf("window.openOnboardingManually");
      const fnBody  = src.slice(fnStart, fnStart + 400);
      expect(fnBody, label).toContain("_fpRenderOnboardingModal()");
      expect(fnBody, label).toContain("removeAttribute('hidden')");
    });
  });

});

describe("onboarding steps configuration", () => {

  it("FP_ONBOARDING_STEPS defines exactly 4 steps (both files)", () => {
    bothFiles((src, label) => {
      const stepsStart = src.indexOf("FP_ONBOARDING_STEPS = [");
      expect(stepsStart, `${label}: FP_ONBOARDING_STEPS not found`).toBeGreaterThanOrEqual(0);
      const stepsEnd = src.indexOf("];", stepsStart);
      const stepsBlock = src.slice(stepsStart, stepsEnd + 2);
      const ids = (stepsBlock.match(/id:\s*'/g) || []).length;
      expect(ids, label).toBe(4);
    });
  });

  it("all 4 step videoUrl values are null (videos not yet available)", () => {
    // When videoUrl is null the placeholder is shown — we must NOT fabricate URLs.
    bothFiles((src, label) => {
      const stepsStart = src.indexOf("FP_ONBOARDING_STEPS = [");
      const stepsEnd   = src.indexOf("];", stepsStart);
      const stepsBlock = src.slice(stepsStart, stepsEnd + 2);
      const urlMatches = (stepsBlock.match(/videoUrl:/g) || []).length;
      const nullMatches = (stepsBlock.match(/videoUrl:\s*null/g) || []).length;
      expect(urlMatches, `${label}: videoUrl count`).toBe(4);
      expect(nullMatches, `${label}: all null`).toBe(4);
    });
  });

  it("Précédent/Suivant navigation uses _fpObGoTo assigned to window (both files)", () => {
    bothFiles((src, label) => {
      expect(src, label).toMatch(/window\._fpObGoTo\s*=/);
    });
  });

});

describe("Settings card spacing — Visite guidée", () => {

  it("Visite guidée card has margin-top for visual separation (both files)", () => {
    bothFiles((src, label) => {
      // The card immediately above is WORKSPACE PRESETS; the fix adds margin-top:24px.
      expect(src, label).toMatch(/VISITE GUID[ÉE]E[\s\S]{0,80}margin-top:24px/);
    });
  });

});
