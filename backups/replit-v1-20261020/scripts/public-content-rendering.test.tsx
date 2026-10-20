import assert from "node:assert/strict";
import test from "node:test";
import { render } from "../client/src/entry-server";

// Run: npx tsx --tsconfig scripts/tsconfig.accessibility.json --test scripts/public-content-rendering.test.tsx
const publicRoutes = [
  "/",
  "/seo-audit",
  "/local-seo",
  "/website-monitoring",
  "/seo-reporting",
  "/competitor-analysis",
  "/ressources",
  "/fonctionnalites",
  "/tarifs",
  "/avantages",
  "/mises-a-jour",
  "/a-propos",
  "/carrieres",
  "/contact",
  "/mentions-legales",
  "/informations-legales",
];

for (const route of publicRoutes) {
  test(`${route}: server-rendered content is visible before hydration or scrolling`, () => {
    // No browser, hydration, effects, or IntersectionObserver runs here.
    // Framer Motion resolves both direct and inherited initial variants in SSR.
    const html = render(route);
    assert.match(html, /<h1\b/, "the primary heading must be in the server response");
    assert.match(html, /<h2\b/, "below-the-fold content must be in the server response");
    assert.match(html, /<a\b[^>]*href="\/[^"]*"/, "internal links must be in the server response");

    const styles = [...html.matchAll(/\bstyle="([^"]*)"/g)].map(match => match[1]);
    assert.ok(styles.some(style => /(?:^|;)\s*opacity:\s*1(?:;|$)/.test(style)),
      "the server must explicitly render the initial motion state as opaque");
    for (const style of styles) {
      assert.doesNotMatch(style, /(?:^|;)\s*opacity:\s*0(?:\.0*)?(?:;|$)/,
        "no content container or inherited motion child may start transparent");
      assert.doesNotMatch(style, /(?:^|;)\s*visibility:\s*hidden(?:;|$)/,
        "content must not rely on JavaScript to become visible");
    }
  });
}
