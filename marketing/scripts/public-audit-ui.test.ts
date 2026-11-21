import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  "client/src/components/home/flowpoint-landing/PublicAuditWidget.css",
  "utf8",
);
const landingStyles = readFileSync(
  "client/src/components/home/flowpoint-landing/LandingV2.css",
  "utf8",
);
const widgetSource = readFileSync(
  "client/src/components/home/flowpoint-landing/PublicAuditWidget.tsx",
  "utf8",
);

test("audit form and report switch to a single-column layout on narrow screens", () => {
  const mobileRules = styles.match(
    /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(mobileRules, "a narrow-screen layout should be defined");
  assert.match(mobileRules, /\.fp-audit__input-row\s*\{\s*flex-direction:\s*column;/);
  assert.match(mobileRules, /\.fp-audit__input-row button\s*\{\s*width:\s*100%;/);
  assert.match(mobileRules, /\.fp-audit__category-list\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(mobileRules, /\.fp-audit__recommendation\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(mobileRules, /\.fp-audit__plan-links\s*\{\s*display:\s*grid;/);
});

test("audit controls keep keyboard focus and respect reduced-motion settings", () => {
  assert.match(styles, /\.fp-audit :is\(button, a, input, summary\):focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("audit results show evidence coverage, problem severity, and all plan CTAs", () => {
  assert.match(widgetSource, /report\.coverage\.measuredChecks/);
  assert.match(widgetSource, /action\.severity/);
  assert.match(widgetSource, /action\.evidence/);
  assert.match(widgetSource, /action\.impact/);
  assert.match(widgetSource, /action\.reason/);
  assert.match(widgetSource, /report\.recommendation\.planLinks\.map/);
  assert.match(widgetSource, /Explore \{plan\}/);
});

test("homepage hero glow stays within the viewport", () => {
  const heroGlow = landingStyles.match(/\.fp2-hero::before\s*\{([^}]+)\}/)?.[1];
  assert.ok(heroGlow, "the hero glow should remain defined");
  assert.match(heroGlow, /\bright:\s*0(?:px)?\s*;/);
});
