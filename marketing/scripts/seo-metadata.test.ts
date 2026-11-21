import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { injectMetadata, ROUTE_METADATA } from "../server/seo-metadata";
import {
  getProductionResourceArticles,
  getResourceArticleCanonical,
  getResourceArticleFromPath,
  RESOURCE_SITE_URL,
} from "../shared/resource-articles";
import { HOME_FAQS } from "../shared/home-faqs";
import {
  buildFaqPageJsonLd,
  buildResourcesItemListJsonLd,
  getPricingFaqs,
  PRICING_FAQS,
  PRICING_TRIAL_FAQ_ANSWER_FR,
  RESOURCE_HUB,
  SEO_AUDIT_FAQS,
} from "../shared/structured-data-content";
import { SEO_CLUSTER_CONTENT } from "../shared/seo-cluster-content";
import { appendResourceArticlesToSitemap } from "../shared/resource-sitemap";

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

test("commercial landing metadata matches the visible page content", () => {
  const clusterPaths = [
    "/local-seo",
    "/website-monitoring",
    "/seo-reporting",
    "/competitor-analysis",
  ] as const;

  for (const path of clusterPaths) {
    const content = SEO_CLUSTER_CONTENT[path];
    const metadata = ROUTE_METADATA[path];
    assert.equal(content.title, metadata.title, `${path} title`);
    assert.equal(content.description, metadata.description, `${path} description`);
    assert.ok(metadata.title.length >= 50 && metadata.title.length <= 65, `${path} title length`);
    assert.ok(metadata.description.length >= 150 && metadata.description.length <= 160, `${path} description length`);
    assert.ok(injectMetadata(template, path).includes(`<title>${metadata.title}</title>`), path);
  }

  const auditTitle = "SEO Audit Software for Website Analysis | FlowPoint";
  const audit = readFileSync("client/src/pages/SeoAudit.tsx", "utf8");
  assert.equal(ROUTE_METADATA["/seo-audit"].title, auditTitle);
  assert.match(audit, /usePageTitle\("SEO Audit Software for Website Analysis \| FlowPoint"\)/);
  assert.ok(ROUTE_METADATA["/seo-audit"].title.length >= 50);
  assert.ok(ROUTE_METADATA["/seo-audit"].description.length >= 150);
  assert.match(audit, /href="\/resources\/audit-seo-pme-priorites"/);
  assert.match(audit, /href="\/resources\/interpreter-resultats-audit-seo"/);
});

test("homepage server schema exactly matches the shared visible English FAQ", () => {
  const schemas = jsonLd(injectMetadata(template, "/"));
  assert.deepEqual(schemas, [buildFaqPageJsonLd(HOME_FAQS)]);
  assert.equal(HOME_FAQS.length, 8);
  assert.equal(HOME_FAQS[0].question, "How soon can I see results?");
  assert.doesNotMatch(JSON.stringify(schemas), /14-day|sans carte bancaire|sous 24h/);

  const current = readFileSync("client/src/components/home/flowpoint-landing/Current.tsx", "utf8");
  assert.match(current, /import \{ HOME_FAQS as landingV2Faqs \} from "@shared\/home-faqs"/);
  assert.match(current, /landingV2Faqs\.map\(/);
  assert.match(current, /\{faq\.question\}/);
  assert.match(current, /\{faq\.answer\}/);
  const home = readFileSync("client/src/pages/Home.tsx", "utf8");
  assert.match(home, /import \{ HOME_FAQS \} from "@shared\/home-faqs"/);
  assert.match(home, /useJsonLd\(buildFaqPageJsonLd\(HOME_FAQS\)\)/);
});

test("organization schema includes the official social profiles supplied for FlowPoint", () => {
  const siteSchema = JSON.parse(
    template.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}",
  ) as {
    "@graph"?: {
      "@type": string;
      name?: string;
      description?: string;
      sameAs?: string[];
    }[];
  };
  const website = siteSchema["@graph"]?.find(item => item["@type"] === "WebSite");
  const organization = siteSchema["@graph"]?.find(item => item["@type"] === "Organization");
  assert.equal(website?.name, "FlowPoint");
  assert.equal(organization?.name, "FlowPoint");
  assert.equal(website?.description, ROUTE_METADATA["/"].description);
  assert.equal(organization?.description, ROUTE_METADATA["/"].description);
  assert.ok(ROUTE_METADATA["/"].description.length >= 150);
  assert.ok(ROUTE_METADATA["/"].description.length <= 160);
  assert.deepEqual(organization?.sameAs, [
    "https://www.instagram.com/flowpoint.pro/",
    "https://www.tiktok.com/@flowpoint.pro",
  ]);
});

test("key marketing pages use the official brand and broad product description", () => {
  const about = readFileSync("client/src/pages/About.tsx", "utf8");
  const features = readFileSync("client/src/pages/Features.tsx", "utf8");

  assert.match(ROUTE_METADATA["/a-propos"].title, /^About FlowPoint/);
  assert.match(ROUTE_METADATA["/a-propos"].description, /digital-growth SaaS workspace/);
  assert.match(about, /About FlowPoint/);
  assert.match(about, /website monitoring, analytics and reporting/);
  assert.doesNotMatch(about, /local restaurants and independent tradespeople/);

  assert.match(ROUTE_METADATA["/fonctionnalites"].title, /^FlowPoint Platform Features/);
  assert.match(ROUTE_METADATA["/fonctionnalites"].description, /SEO audits, local search, competitor analysis/);
  assert.match(features, /usePageTitle\("FlowPoint Platform Features for SEO & Digital Growth"\)/);
  assert.match(features, /Explore FlowPoint's digital-growth platform/);
});

test("SEO audit server schema matches its visible English FAQ", () => {
  const schemas = jsonLd(injectMetadata(template, "/seo-audit"));
  assert.deepEqual(schemas, [buildFaqPageJsonLd(SEO_AUDIT_FAQS)]);
  assert.doesNotMatch(JSON.stringify(schemas), /Qu'est-ce qu'un audit|Que vérifie|Pourquoi réaliser/);

  const page = readFileSync("client/src/pages/SeoAudit.tsx", "utf8");
  assert.match(page, /import \{ SEO_AUDIT_FAQS \} from "@shared\/structured-data-content"/);
  assert.match(page, /const faqs = SEO_AUDIT_FAQS/);
});

test("pricing FAQ schema has exact English and French trial disclosures", () => {
  const pricing = readFileSync("client/src/pages/Pricing.tsx", "utf8");
  const englishSchema = jsonLd(injectMetadata(template, "/pricing"))[0];
  const frenchSchema = jsonLd(injectMetadata(template, "/pricing", "fr"))[0];
  const answers = (schema: Record<string, unknown>) =>
    ((schema.mainEntity as Array<Record<string, unknown>>) || [])
      .map((item) => (item.acceptedAnswer as Record<string, unknown>)?.text)
      .filter((answer): answer is string => typeof answer === "string");
  const englishAnswer = PRICING_FAQS.find((faq) => faq.question === "What happens after the 14-day trial.")?.answer
    || PRICING_FAQS.find((faq) => faq.question === "What happens after the 14-day trial?")?.answer;

  assert.ok(englishAnswer);
  assert.ok(answers(englishSchema).includes(englishAnswer));
  assert.ok(answers(frenchSchema).includes(PRICING_TRIAL_FAQ_ANSWER_FR));
  assert.ok(pricing.includes("getPricingFaqs(displayLanguage)"));
  assert.match(pricing, /<AccordionContent\s+forceMount/);
  assert.ok(pricing.includes("translate=\"no\">{faq.answer}"));
  assert.ok(pricing.includes("href={`${EXTERNAL_URL}?plan=${plan.name.toLowerCase()}`}"));
  assert.ok(pricing.includes("plan.name.toLowerCase()"));
  assert.ok(pricing.includes("<TrialDisclosure showPricingLink={false} className=\"mt-2\" />"));
  assert.doesNotMatch(pricing, /After your 14-day trial, choose the plan that fits your needs/);
  assert.match(injectMetadata(template, "/pricing", "fr"), /<html lang="fr">/);
  assert.match(injectMetadata(template, "/pricing", "en"), /<html lang="en">/);
});

test("resource schemas use the English canonical URL and breadcrumb labels", () => {
  assert.equal(RESOURCE_HUB.url, `${RESOURCE_SITE_URL}/resources`);
  assert.equal(buildResourcesItemListJsonLd().url, `${RESOURCE_SITE_URL}/resources`);

  const article = getProductionResourceArticles()[0];
  const path = new URL(getResourceArticleCanonical(article.slug)).pathname;
  const breadcrumb = jsonLd(injectMetadata(template, path))
    .find(schema => schema["@type"] === "BreadcrumbList") as {
      itemListElement: { name: string; item?: string }[];
    } | undefined;
  assert.ok(breadcrumb, path);
  assert.deepEqual(
    breadcrumb.itemListElement.map(item => item.name),
    ["Home", "Resources", article.h1],
  );
  assert.equal(breadcrumb.itemListElement[1].item, `${RESOURCE_SITE_URL}/resources`);
});

test("every production article schema language agrees with the English document shell", () => {
  const language = template.match(/<html[^>]*lang="([^"]+)"/)?.[1];
  assert.equal(language, "en");
  const articles = getProductionResourceArticles();
  assert.ok(articles.length > 0);
  for (const article of articles) {
    const path = new URL(getResourceArticleCanonical(article.slug)).pathname;
    const schema = jsonLd(injectMetadata(template, path)).find(item => item["@type"] === "Article");
    assert.ok(schema, path);
    assert.equal(schema.inLanguage, language, path);
  }
});

test("every published article keeps search, social, and canonical metadata aligned", () => {
  const articles = getProductionResourceArticles();
  assert.equal(articles.length, 38);
  for (const article of articles) {
    const canonical = getResourceArticleCanonical(article.slug);
    const path = new URL(canonical).pathname;
    const html = injectMetadata(template, path);
    const htmlTitle = article.title
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const attributeTitle = htmlTitle.replace(/"/g, "&quot;");
    const description = article.metaDescription
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    assert.ok(html.includes(`<title>${htmlTitle}</title>`), article.slug);
    assert.ok(html.includes(`<meta property="og:title" content="${attributeTitle}"`), article.slug);
    assert.ok(html.includes(`<meta name="twitter:title" content="${attributeTitle}"`), article.slug);
    assert.ok(html.includes(`<meta name="description" content="${description}"`), article.slug);
    assert.ok(html.includes(`<meta property="og:description" content="${description}"`), article.slug);
    assert.ok(html.includes(`<meta property="og:url" content="${canonical}"`), article.slug);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), article.slug);
  }
});

test("discovery files and generated production sitemap advertise canonical URLs only", () => {
  const sitemap = readFileSync("client/public/sitemap.xml", "utf8");
  const guide = readFileSync("client/public/llms.txt", "utf8");
  const generated = appendResourceArticlesToSitemap(sitemap, getProductionResourceArticles());
  const guideUrls = [...guide.matchAll(/\]\((https:\/\/flowpoint\.pro[^)]*)\)/g)].map(match => match[1]);
  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(new Set(guideUrls), new Set(sitemapUrls));

  const aliases = {
    "/fonctionnalites": "/features",
    "/tarifs": "/pricing",
    "/avantages": "/benefits",
    "/a-propos": "/about",
    "/carrieres": "/careers",
    "/mentions-legales": "/legal-notice",
    "/informations-legales": "/legal-information",
    "/mises-a-jour": "/updates",
    "/ressources": "/resources",
  };
  for (const [legacy, canonical] of Object.entries(aliases)) {
    const expected = `${RESOURCE_SITE_URL}${canonical}`;
    assert.ok(sitemapUrls.includes(expected), canonical);
    assert.ok(!sitemapUrls.includes(`${RESOURCE_SITE_URL}${legacy}`), legacy);
    for (const path of [legacy, canonical]) {
      assert.ok(injectMetadata(template, path).includes(`<link rel="canonical" href="${expected}"`), path);
    }
  }

  const generatedUrls = [...generated.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(new Set(generatedUrls).size, generatedUrls.length);
  for (const url of [...guideUrls, ...generatedUrls]) {
    const html = injectMetadata(template, new URL(url).pathname);
    assert.ok(html.includes(`<link rel="canonical" href="${url}"`), url);
    assert.doesNotMatch(html, /<meta name="robots" content="noindex/);
  }
  for (const article of getProductionResourceArticles()) {
    assert.ok(generatedUrls.includes(getResourceArticleCanonical(article.slug)), article.slug);
  }
});

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
  const resource = getResourceArticleFromPath(path);
  assert.ok(resource);
  const canonical = getResourceArticleCanonical(resource.slug);
  assert.ok(article.includes(`<link rel="canonical" href="${canonical}"`));
  assert.deepEqual(jsonLd(article).map(schema => schema["@type"]), ["Article", "BreadcrumbList"]);

  const home = injectMetadata(template, "/");
  assert.ok(home.includes(`<link rel="canonical" href="${RESOURCE_SITE_URL}/"`));
  assert.ok(home.includes(`<meta property="og:url" content="${RESOURCE_SITE_URL}/"`));
  assert.match(home, /<meta property="og:type" content="website"/);
  assert.doesNotMatch(home, /noindex/);
  assert.deepEqual(jsonLd(home).map(schema => schema["@type"]), ["FAQPage"]);
  assert.ok(!home.includes(canonical));
});

test("all nine revised titles fit 50–65 characters and match search and social titles", () => {
  for (const slug of slugs) {
    const path = `/ressources/${slug}`;
    const article = getResourceArticleFromPath(path);
    assert.ok(article, slug);
    assert.ok(article.title.length >= 50 && article.title.length <= 65,
      `${slug}: ${article.title.length} characters`);
    assert.match(article.title, / \| Flow[Pp]oint$/, slug);
    const html = injectMetadata(template, path);
    assert.ok(html.includes(`<title>${article.title}</title>`), slug);
    assert.ok(html.includes(`<meta property="og:title" content="${article.title}"`), slug);
    assert.ok(html.includes(`<meta name="twitter:title" content="${article.title}"`), slug);
    assert.equal(jsonLd(html)[0].headline, article.h1, "keep the editorial headline");
  }
});
