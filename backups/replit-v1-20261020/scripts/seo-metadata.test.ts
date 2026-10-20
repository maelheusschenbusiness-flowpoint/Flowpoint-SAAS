import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { injectMetadata, ROUTE_METADATA } from "../server/seo-metadata";
import {
  getResourceArticleFromPath,
  RESOURCE_SITE_URL,
} from "../shared/resource-articles";

// Run: npx tsx --test scripts/seo-metadata.test.ts
const template = readFileSync("client/index.html", "utf8");
const slugs = [
  "analyse-backlinks-concurrents",
  "guide-referencement-local",
  "monitoring-disponibilite-site",
  "monitoring-seo-guide",
  "mots-cles-seo-local",
  "optimiser-google-business-profile",
  "pages-locales-seo",
  "rapport-seo-automatique",
  "reporting-seo-pme",
];

function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json" data-json-ld="true">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]));
}

test("logo and thank-you return link use unhandled document-navigation anchors", () => {
  for (const file of [
    "client/src/components/Navigation.tsx",
    "client/src/pages/ThankYou.tsx",
  ]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const homeLinks: ts.JsxOpeningElement[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node)) {
        const href = node.attributes.properties.find(attr =>
          ts.isJsxAttribute(attr) && attr.name.getText(source) === "href" &&
          attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === "/",
        );
        if (href) homeLinks.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(homeLinks.length, 1, file);
    assert.equal(homeLinks[0].tagName.getText(source), "a", file);
    assert.ok(homeLinks[0].attributes.properties.every(attr =>
      ts.isJsxAttribute(attr) && !/^on[A-Z]/.test(attr.name.getText(source)),
    ), `${file}: do not intercept home navigation`);
    assert.doesNotMatch(source.text, /from ["']wouter["']/);
    if (file.includes("ThankYou")) {
      assert.match(source.text, /<Button asChild[\s\S]*?<a href="\/">/);
    }
  }
});

test("a fresh homepage document after merci restores indexability and homepage metadata", () => {
  const merci = injectMetadata(template, "/merci");
  assert.match(merci, /<meta name="robots" content="noindex,follow"/);

  // Native anchors request a new template, rather than reusing the old head.
  const home = injectMetadata(template, "/");
  assert.doesNotMatch(home, /noindex/);
  assert.ok(home.includes(`<title>${ROUTE_METADATA["/"].title}</title>`));
  assert.ok(home.includes(`<link rel="canonical" href="${RESOURCE_SITE_URL}/"`));
  assert.ok(home.includes(`<meta name="description" content="${ROUTE_METADATA["/"].description}"`));
  assert.ok(home.includes(`<meta property="og:title" content="${ROUTE_METADATA["/"].title}"`));
  assert.ok(home.includes(`<meta name="twitter:title" content="${ROUTE_METADATA["/"].title}"`));
  assert.ok(jsonLd(home).some(schema => schema["@type"] === "FAQPage"));
});

test("a fresh homepage document after an article has homepage canonical and schema only", () => {
  const path = "/ressources/guide-referencement-local";
  const article = injectMetadata(template, path);
  assert.ok(article.includes(`<link rel="canonical" href="${RESOURCE_SITE_URL}${path}"`));
  assert.deepEqual(jsonLd(article).map(schema => schema["@type"]), ["Article", "BreadcrumbList"]);

  const home = injectMetadata(template, "/");
  assert.ok(home.includes(`<link rel="canonical" href="${RESOURCE_SITE_URL}/"`));
  assert.ok(home.includes(`<meta property="og:url" content="${RESOURCE_SITE_URL}/"`));
  assert.match(home, /<meta property="og:type" content="website"/);
  assert.doesNotMatch(home, /noindex/);
  assert.deepEqual(jsonLd(home).map(schema => schema["@type"]), ["FAQPage"]);
  assert.ok(!home.includes(`${RESOURCE_SITE_URL}${path}`));
});

test("all nine revised titles fit 50–65 characters and match search and social titles", () => {
  for (const slug of slugs) {
    const path = `/ressources/${slug}`;
    const article = getResourceArticleFromPath(path);
    assert.ok(article, slug);
    assert.ok(article.title.length >= 50 && article.title.length <= 65,
      `${slug}: ${article.title.length} characters`);
    assert.ok(article.title.endsWith(" | Flowpoint"), slug);
    const html = injectMetadata(template, path);
    assert.ok(html.includes(`<title>${article.title}</title>`), slug);
    assert.ok(html.includes(`<meta property="og:title" content="${article.title}"`), slug);
    assert.ok(html.includes(`<meta name="twitter:title" content="${article.title}"`), slug);
    assert.equal(jsonLd(html)[0].headline, article.h1, "keep the editorial headline");
  }
});
