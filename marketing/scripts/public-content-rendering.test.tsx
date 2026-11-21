import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { getPricingFaqs } from "../shared/structured-data-content";

// Test the production SSR bundle (including its CSS handling), not a Node-only
// source import: the homepage imports stylesheets that tsx cannot load.
// Run: npm run build && npx tsx --test scripts/public-content-rendering.test.tsx
const { render } = createRequire(import.meta.url)("../dist/server/entry-server.cjs") as {
  render: (url: string, language?: string) => string;
};
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
  "/pricing",
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

test("pricing trial FAQ and disclosures are server-rendered in English and French", () => {
  const english = render("/pricing", "en");
  const french = render("/pricing", "fr");
  const englishAnswer = getPricingFaqs("en").find(
    (faq) => faq.question === "What happens after the 14-day trial?",
  )?.answer;
  const frenchAnswer = getPricingFaqs("fr").find(
    (faq) => faq.question === "What happens after the 14-day trial?",
  )?.answer;
  const frenchAnswerHtml = frenchAnswer?.replace(/'/g, "&#x27;");

  assert.ok(englishAnswer);
  assert.ok(frenchAnswer);
  assert.ok(frenchAnswerHtml);
  assert.ok(english.includes(englishAnswer), "English answer must be in the SSR markup");
  assert.ok(french.includes(frenchAnswerHtml), "French answer must be in the SSR markup");
  assert.ok(english.includes("Card required · billed automatically after 14 days unless cancelled"));
  assert.ok(french.includes("Carte bancaire requise · débit automatique après 14 jours sauf annulation"));
  assert.match(french, /<span lang="fr" translate="no">Tous les plans incluent/);
  assert.match(english, /href="https:\/\/app\.flowpoint\.pro\/signin\.html\?plan=standard"/);
  assert.match(english, /href="https:\/\/app\.flowpoint\.pro\/signin\.html\?plan=pro"/);
  assert.match(english, /href="https:\/\/app\.flowpoint\.pro\/signin\.html\?plan=ultra"/);
});

test("homepage renders the connected-signals and security replacements without browser effects", () => {
  const html = render("/");
  const benefits = html.match(/<section\b[^>]*id="benefits"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  const security = html.match(/<section\b[^>]*class="fp2-premium fp2-premium-security"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(benefits, "the benefit section must be server-rendered");
  assert.ok(security, "the security section must be server-rendered");

  assert.match(benefits, /From scattered signals<br\s*\/?>to a clearer next step\./);
  assert.match(benefits, /Your data brings the context\. AI helps connect the dots\./);
  assert.match(benefits, /id="connected-preview"/, "the deep-link target exists before hydration");
  assert.match(benefits, /role="tabpanel"/, "the initial interactive preview must also render on the server");
  assert.match(security, /<h2 id="fp2-premium-security-title">/);
  for (const copy of ["WORKSPACE SAFEGUARDS", "Context-aware access", "Tracked actions", "Controlled exports"]) {
    assert.ok(security.includes(copy), `${copy} must be in the initial HTML`);
  }
  assert.doesNotMatch(benefits, /fp2-results-wrap/, "obsolete benefit markup must not duplicate the replacement");
  assert.doesNotMatch(security, /fp2-premium-wrap/, "obsolete security markup must not duplicate the replacement");
  assert.equal((html.match(/id="fp2-premium-security-title"/g) ?? []).length, 1);
});

test("homepage audit form is included in the initial server-rendered markup", () => {
  const html = render("/");
  assert.match(html, /id="public-audit"/);
  assert.match(html, /aria-label="Free website audit"/);
  assert.match(html, /No account needed/);
  assert.match(html, /URL, cookie &amp; IP-based quota/);
  assert.match(html, /is not saved in quota records/);
  assert.match(html, /A signed visitor cookie lasts 48 hours/);
  assert.match(html, /People sharing an IP share its 5-audit limit/);
  assert.match(html, /No credit card/);
  assert.match(html, /Query strings are ignored/);
});

test("legal pages disclose public-audit quota data and the essential cookie", () => {
  const html = render("/informations-legales");
  assert.match(html, /fp_public_audit_visitor/);
  assert.match(html, /three audits per visitor per UTC day/);
  assert.match(html, /expires after 48 hours/);
  assert.match(html, /HMAC-derived keys for that visitor and the normalized exact IP address/);
  assert.match(html, /00:00 UTC two days after its quota date/);
  assert.match(html, /actual deletion can be later if cleanup fails/);
  assert.match(html, /five per exact public IP per UTC day, ten audits total per UTC day/);
  assert.match(html, /quota counters are stored in its managed PostgreSQL database/);
});

test("homepage section delivery does not depend on post-mount portals or hidden legacy wrappers", () => {
  const landing = readFileSync("client/src/components/home/flowpoint-landing/LandingV2.tsx", "utf8");
  const css = readFileSync("client/src/components/home/flowpoint-landing/ConnectedView.css", "utf8");
  assert.doesNotMatch(landing, /sectionTargets|createPortal\(<(?:SignalExplorer|SecurityControls)/);
  assert.doesNotMatch(css, /(?:fp2-results-wrap|fp2-premium-wrap)[^{]*\{[^}]*display:\s*none/);
});
