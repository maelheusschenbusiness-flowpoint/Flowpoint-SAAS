import {
  RESOURCE_ARTICLE_CERTIFICATION,
  RESOURCE_ARTICLE_DRAFT_FIXTURE,
} from "./resource-article-certification";
import { RESOURCE_ARTICLE_CHECKLIST } from "./resource-article-checklist";
import { RESOURCE_ARTICLE_AUDIT_FREQUENCY } from "./resource-article-audit-frequency";
import { RESOURCE_ARTICLE_AUDIT_SEO_PME_PRIORITES } from "./resource-article-audit-seo-pme-priorites";
import { RESOURCE_ARTICLE_AUDIT_SEO_LOCAL } from "./resource-article-audit-seo-local";
import { RESOURCE_ARTICLE_AVIS_GOOGLE_SEO_LOCAL } from "./resource-article-avis-google-seo-local";
import { RESOURCE_ARTICLE_CONTENT_AUDIT } from "./resource-article-content-audit";
import { RESOURCE_ARTICLE_GUIDE_REFERENCEMENT_LOCAL } from "./resource-article-guide-referencement-local";
import { RESOURCE_ARTICLE_INTERPRETER_AUDIT } from "./resource-article-interpreter-audit";
import { RESOURCE_ARTICLE_MOTS_CLES_SEO_LOCAL } from "./resource-article-mots-cles-seo-local";
import { RESOURCE_ARTICLE_OPTIMISER_GOOGLE_BUSINESS_PROFILE } from "./resource-article-optimiser-google-business-profile";
import { RESOURCE_ARTICLE_PAGES_LOCALES_SEO } from "./resource-article-pages-locales-seo";
import { RESOURCE_ARTICLE_REFERENCEMENT_GOOGLE_MAPS } from "./resource-article-referencement-google-maps";
import { RESOURCE_ARTICLE_SUIVI_REFERENCEMENT_LOCAL } from "./resource-article-suivi-referencement-local";
import { RESOURCE_ARTICLE_ALERTES_MONITORING_SITE } from "./resource-article-alertes-monitoring-site";
import { RESOURCE_ARTICLE_AUDIT_SEO_VS_MONITORING } from "./resource-article-audit-seo-vs-monitoring";
import { RESOURCE_ARTICLE_CHOISIR_OUTIL_MONITORING_SEO } from "./resource-article-choisir-outil-monitoring-seo";
import { RESOURCE_ARTICLE_MONITORING_DISPONIBILITE_SITE } from "./resource-article-monitoring-disponibilite-site";
import { RESOURCE_ARTICLE_MONITORING_SEO_AUTOMATIQUE } from "./resource-article-monitoring-seo-automatique";
import { RESOURCE_ARTICLE_MONITORING_SEO_GUIDE } from "./resource-article-monitoring-seo-guide";
import { RESOURCE_ARTICLE_SUIVI_PERFORMANCES_SITE_WEB } from "./resource-article-suivi-performances-site-web";
import { RESOURCE_ARTICLE_SURVEILLANCE_SITE_WEB_INDICATEURS } from "./resource-article-surveillance-site-web-indicateurs";
import { RESOURCE_ARTICLE_CHOISIR_OUTIL_REPORTING_SEO } from "./resource-article-choisir-outil-reporting-seo";
import { RESOURCE_ARTICLE_RAPPORT_GOOGLE_SEARCH_CONSOLE } from "./resource-article-rapport-google-search-console";
import { RESOURCE_ARTICLE_RAPPORT_SEO_AUTOMATIQUE } from "./resource-article-rapport-seo-automatique";
import { RESOURCE_ARTICLE_RAPPORT_SEO_MENSUEL } from "./resource-article-rapport-seo-mensuel";
import { RESOURCE_ARTICLE_REPORTING_SEO_CLIENT } from "./resource-article-reporting-seo-client";
import { RESOURCE_ARTICLE_REPORTING_SEO_GUIDE } from "./resource-article-reporting-seo-guide";
import { RESOURCE_ARTICLE_REPORTING_SEO_PME } from "./resource-article-reporting-seo-pme";
import { RESOURCE_ARTICLE_TABLEAU_DE_BORD_SEO_KPI } from "./resource-article-tableau-de-bord-seo-kpi";
import { RESOURCE_ARTICLE_ANALYSE_BACKLINKS_CONCURRENTS } from "./resource-article-analyse-backlinks-concurrents";
import { RESOURCE_ARTICLE_ANALYSE_CONCURRENTIELLE_SEO_GUIDE } from "./resource-article-analyse-concurrentielle-seo-guide";
import { RESOURCE_ARTICLE_ANALYSE_CONTENU_CONCURRENTS } from "./resource-article-analyse-contenu-concurrents";
import { RESOURCE_ARTICLE_ANALYSE_MOTS_CLES_CONCURRENTS } from "./resource-article-analyse-mots-cles-concurrents";
import { RESOURCE_ARTICLE_BENCHMARK_SEO_INDICATEURS } from "./resource-article-benchmark-seo-indicateurs";
import { RESOURCE_ARTICLE_CHOISIR_OUTIL_ANALYSE_CONCURRENTIELLE_SEO } from "./resource-article-choisir-outil-analyse-concurrentielle-seo";
import { RESOURCE_ARTICLE_IDENTIFIER_CONCURRENTS_SEO } from "./resource-article-identifier-concurrents-seo";
import { RESOURCE_ARTICLE_OPPORTUNITES_SEO_CONCURRENCE } from "./resource-article-opportunites-seo-concurrence";

export const RESOURCE_SITE_URL = "https://flowpoint.pro";
export const RESOURCE_HUB_PATH = "/resources";
const ENGLISH_RESOURCE_SLUGS: Record<string, string> = {
  "analyse-contenu-concurrents": "competitor-content-analysis",
  "analyse-concurrentielle-seo-guide": "seo-competitor-analysis-guide",
  "analyse-backlinks-concurrents": "competitor-backlink-analysis",
  "alertes-monitoring-site": "website-monitoring-alerts",
  "audit-seo-pme-priorites": "small-business-seo-audit-priorities",
  "audit-seo-local": "local-seo-audit",
  "analyse-mots-cles-concurrents": "competitor-keyword-analysis",
  "benchmark-seo-indicateurs": "seo-benchmark-metrics",
  "frequence-audit-seo-site": "website-seo-audit-frequency",
  "choisir-outil-reporting-seo": "choose-seo-reporting-tool",
  "audit-seo-vs-monitoring": "seo-audit-vs-monitoring",
  "choisir-outil-monitoring-seo": "choose-seo-monitoring-tool",
  "interpreter-resultats-audit-seo": "interpret-seo-audit-results",
  "identifier-concurrents-seo": "identify-seo-competitors",
  "avis-google-seo-local": "google-reviews-local-seo",
  "checklist-audit-seo-technique": "technical-seo-audit-checklist",
  "mots-cles-seo-local": "local-seo-keywords",
  "monitoring-seo-guide": "seo-monitoring-guide",
  "rapport-google-search-console": "google-search-console-report",
  "audit-contenu-seo": "seo-content-audit",
  "pages-locales-seo": "local-seo-pages",
  "referencement-google-maps": "google-maps-rankings",
  "reporting-seo-client": "client-seo-reporting",
  "monitoring-disponibilite-site": "website-uptime-monitoring",
  "choisir-outil-analyse-concurrentielle-seo": "choose-seo-competitor-analysis-tool",
  "suivi-performances-site-web": "website-performance-tracking",
  "suivi-referencement-local": "local-seo-rank-tracking",
  "opportunites-seo-concurrence": "competitor-seo-opportunities",
  "guide-referencement-local": "local-seo-guide",
  "rapport-seo-mensuel": "monthly-seo-report",
  "tableau-de-bord-seo-kpi": "seo-kpi-dashboard",
  "rapport-seo-automatique": "automated-seo-report",
  "reporting-seo-pme": "small-business-seo-reporting",
  "monitoring-seo-automatique": "automated-seo-monitoring",
  "reporting-seo-guide": "seo-reporting-guide",
  "optimiser-google-business-profile": "optimize-google-business-profile",
  "surveillance-site-web-indicateurs": "website-monitoring-metrics",
  "brouillon-test-non-publie": "unpublished-test-draft",
};
const LEGACY_RESOURCE_SLUGS = Object.fromEntries(
  Object.entries(ENGLISH_RESOURCE_SLUGS).map(([legacy, english]) => [english, legacy]),
) as Record<string, string>;

export interface ResourceArticleLink {
  label: string;
  href: string;
}

export type ResourceArticleParagraph =
  | string
  | readonly (string | ResourceArticleLink)[];

export interface ResourceArticleTable {
  caption: string;
  description: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface ResourceArticleCta {
  heading: string;
  description: string;
  label: string;
}

export interface ResourceArticleSection {
  heading?: string;
  headingLevel?: 2 | 3;
  paragraphs?: readonly ResourceArticleParagraph[];
  bullets?: readonly string[];
  table?: ResourceArticleTable;
  links?: readonly ResourceArticleLink[];
}

export interface ResourceArticle {
  slug: string;
  title: string;
  metaDescription: string;
  h1: string;
  cluster: string;
  parentLanding: string;
  datePublished: string;
  dateModified: string;
  author: string;
  parentLandingCta?: ResourceArticleCta | null;
  published: boolean;
  testOnly?: boolean;
  content: readonly ResourceArticleSection[];
  relatedArticles: readonly string[];
}

const EDITORIAL_ARTICLES: readonly ResourceArticle[] = [
  {
    slug: "comment-faire-audit-seo-site-web",
    title: "How to perform an SEO audit of your website? | Flowpoint",
    metaDescription:
      "Learn how to perform an SEO audit of your site: setting objectives, checking technical aspects and pages, reading data, and then prioritizing actions.",
    h1: "How to perform an SEO audit of your website? Step-by-step method",
    cluster: "SEO Audit",
    parentLanding: "/seo-audit",
    parentLandingCta: {
      heading: "Do you want a more guided diagnostic?",
      description:
        "Discover the Flowpoint SEO Audit page and the checks, metrics, and recommendations presented for your site.",
      label: "Discover the SEO Audit page",
    },
    datePublished: "2026-10-07",
    dateModified: "2026-10-07",
    author: "Flowpoint Team",
    published: true,
    content: [
      {
        paragraphs: [
          "A useful SEO audit is not just about getting a score or accumulating alerts. It consists of examining evidence, understanding what concerns your site's important pages, and then choosing actions that you can verify. This method is intended for people who want to perform an initial audit with the tools they have access to.",
          "Order matters: start by ensuring that strategic pages can be crawled and indexed, then examine their relevance, quality, and functionality. Finish with an action plan. If you do not have access to a data source, note this limitation instead of filling the gap with an assumption.",
        ],
      },
      {
        heading: "Before starting: scope the perimeter",
        paragraphs: [
          "First, define the purpose of the audit. Are you looking to understand why an important page receives few visits, verify a migration, spot technical errors, or clarify next priorities? A precise question avoids browsing metrics that don't change any decisions.",
          "Then choose the scope: an entire site, a section, a page type, or a few priority URLs. Note the date, the expected canonical domain, recent changes, and people who will be able to verify or correct findings. For a large site, a representative sample can help to start, but it does not replace a check of critical URLs.",
          "Gather the available data. The Google Search Console performance report can show queries and pages that appear in search, as well as their impressions and clicks. A crawl can inventory URLs and their links. Analytics data, if configured, can help link visits to business actions. Each source answers a different question; none alone describes the entire SEO health of the site.",
          "Keep a 'source / limit' column in your notes. For example, a drop in clicks observed in Search Console is a signal to examine; it does not explain its cause alone. Check the scope, period, and pages concerned before concluding.",
          "Establish a baseline before changing anything: which pages are included, what period are you observing, and what recent changes may influence the data? Then use a comparable scope to verify the effects. This does not automatically isolate the cause of an evolution, but helps avoid comparisons between periods or URLs that do not answer the same question.",
        ],
        links: [
          {
            label: "Google Documentation: Search performance report",
            href: "https://support.google.com/webmasters/answer/7576553?hl=en",
          },
        ],
      },
      {
        heading: "Step 1: check crawl and indexing",
        paragraphs: [
          "Start with URLs that serve an important purpose: service page, contact page, offer page, or content that answers an identified search. Verify their HTTP response, indexing directives, and canonical URL. If you have Search Console, the indexing report and URL inspection tool can provide additional elements on how Google sees a page.",
          "Do not confuse mechanisms. The robots.txt file is used to manage crawling; a noindex directive requests not to index a page when the bot can read it. A URL blocked from crawling can be difficult to control, and a robots.txt rule is not a reliable method for removing a page already known to search engines. When in doubt, check the configuration and documentation rather than adding directives in series.",
          "Also consult the XML sitemap: the URLs included should correspond to the pages you want to discover and that are consistent with your canonicals. It provides search engines with information about important URLs, without replacing internal links or a consistent configuration.",
          "Finally, spot internal 404 errors, unnecessary or chained redirects, important pages that are difficult to reach, and competing versions of the same URL. Before correcting, verify which version is truly intended to remain accessible.",
          "Treat inconsistencies as a cluster of signals. A URL in the sitemap, an internal link, and a canonical tag that point to three different versions deserve a check; it does not mean that all three must be changed mechanically. First identify the URL that the company actually wants to keep, then control the links and directives around that decision.",
        ],
        bullets: [
          "Does the page respond with the expected status and without unexpected redirects?",
          "Is it accessible for crawling and does it carry the desired indexing directive?",
          "Does the canonical tag point to the preferred version?",
          "Do internal links and the sitemap lead to this same version?",
        ],
        links: [
          {
            label: "Technical SEO audit checklist: detailed checks",
            href: "/resources/technical-seo-audit-checklist",
          },
          {
            label: "Google Search Central: understanding robots.txt",
            href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=en",
          },
          {
            label: "Google Search Central: create and manage a sitemap",
            href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=en",
          },
          {
            label: "Google Search Central: choose a canonical URL",
            href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=en",
          },
          {
            label: "Search Console Help: URL inspection tool",
            href: "https://support.google.com/webmasters/answer/9012289?hl=en",
          },
        ],
      },
      {
        heading: "Step 2: examine strategic pages",
        paragraphs: [
          "Link important pages to the needs they must serve. A service page, a guide, and a contact page do not have the same role. For each priority URL, note the query or target search group, the target audience, and the action that the page must make possible.",
          "Then read the page like a visitor: does its title correctly describe its subject? Do the H1 and sections announce what the page provides? Does the content really answer the question, or does it just repeat terms? Do internal links help continue the journey? An isolated tag or a missing keyword is not enough to conclude that a page is failing.",
          "Compare pages that seem to target the same intention. If several pages overlap, identify their role and differences before modifying them. It may be more useful to clarify their angle or their linking than to merge the content immediately.",
          "For queries already visible in Search Console, compare the pages displayed and the searches they answer. If you do not have this data, build a hypothesis from the content and the needs of your visitors, then mark it as such.",
          "To go fast without drawing conclusions about the entire site, choose a representative page by template: for example a service page, a product page, or a guide. First check the templates that carry an important objective. If the same problem appears on several URLs built in the same way, examine the common template before correcting each page separately.",
        ],
      },
      {
        heading: "Step 3: check content relevance",
        paragraphs: [
          "On priority pages, verify whether the content provides a clear answer, sufficiently precise and adapted to the intention. Check for outdated information, claims without sources, sections that do not serve the subject, and pages whose content repeats. The question is not 'how many words should be added?', but 'what useful information is missing for the reader?'",
          "If you are examining a set of content, create an inventory with the URL, its role, its known queries, its internal links, and the available data. Categorize possible decisions: keep, update, merge with complementary content, or consider deletion. Before removing a page, check its traffic, links, and possible business functions; provide an appropriate redirect if necessary.",
          "This step remains an initial examination in a general audit. A complete editorial audit requires an inventory and analysis specific to the content; do not mix this work with technical checks alone.",
          "A recent or rarely viewed page is not automatically useless. Take into account its role in the journey, the queries it can answer, the links leading to it, and the information it provides. If the data is too limited to decide, record what is missing and postpone the decision rather than deleting the content by reflex.",
        ],
        links: [
          {
            label: "Method for SEO content and existing page audit",
            href: "/resources/seo-content-audit",
          },
        ],
      },
      {
        heading: "Step 4: examine priority technical signals",
        paragraphs: [
          "Verify that the site is usable on mobile and that priority pages load correctly. If you consult the Core Web Vitals, distinguish field data, resulting from real experiences, from lab measurements produced during a test. They do not represent the same type of observation. A performance variation must be examined on the pages and devices concerned before choosing a correction.",
          "Also spot problems that prevent consultation or complicate the understanding of pages: essential resources inaccessible, repeated errors, unclear navigation, or broken internal links. Note the context, the URL, and the verification method. A technical metric is a diagnostic signal, not a ranking promise; good Core Web Vitals do not alone guarantee a given position.",
          "For each problem, ask yourself if it affects a strategic page, if it is reproducible, and if it has an identified cause. Do not launch a global modification from an isolated screenshot or a score without verifying the expected result.",
          "Measure several representative pages and separate results specific to a URL from those that seem shared by a template. A slow page on a test connection does not alone demonstrate a general problem. Note the device, method, and date of measurement, then try to reproduce the signal before recommending an intervention.",
        ],
        links: [
          {
            label: "Google Search Central: Core Web Vitals metrics",
            href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=en",
          },
          {
            label: "Google Search Central: page experience and search results",
            href: "https://developers.google.com/search/docs/appearance/page-experience?hl=en",
          },
        ],
      },
      {
        heading: "Step 5: read findings and choose initial actions",
        paragraphs: [
          "Before prioritizing a finding, confirm what was observed, on which pages, and with which source. Distinguish the symptom from its possible cause: a page that does not receive clicks may have several explanations, and changing its title is not necessarily the right answer. Write a verifiable hypothesis rather than a certainty that the data does not support.",
          "Then estimate the expected impact according to the role of the page, the effort, the dependencies, and the risk of a modification. These estimates must reflect the site's context, not a universal score. An easy fix is not automatically a priority; a more complex action can be urgent if it touches an essential journey.",
          "For an SME with few resources, start with a small number of important pages and actions that the team can actually lead. Define what will be verified after each change. If you do not yet know the impact or the effort, write 'to be verified' rather than inventing a value.",
          "The following table shows the possible form of a tracking line. The fields 'impact', 'effort', and 'responsible' remain to be filled in by the team after verification: the example does not provide a note ready to be reused.",
        ],
        table: {
          caption:
            "Illustrative table for prioritizing an SEO audit finding.",
          description:
            "Entirely fictional example; it describes neither a client site nor a result measured by Flowpoint.",
          headers: [
            "URL",
            "Finding",
            "Proof to verify",
            "Impact",
            "Effort",
            "Action",
            "Responsible",
            "Follow-up measure",
          ],
          rows: [
            [
              "/services/ (illustrative URL)",
              "Fictional example: the page title could better match the targeted need.",
              "Compare the published title, content, targeted query, and available Search Console data before concluding.",
              "To be qualified according to the page's role and site objectives.",
              "To be estimated after technical and editorial verification.",
              "If the hypothesis is confirmed, propose a title more faithful to the content and have it validated.",
              "To be designated in the team.",
              "Verify the deployed title; compare impressions, clicks, and click-through rate over relevant periods, if data is available.",
            ],
          ],
        },
        links: [
          {
            label: "Interpret and prioritize SEO audit results",
            href: "/resources/interpret-seo-audit-results",
          },
          {
            label: "SEO Audit for SME: what checks to prioritize?",
            href: "/resources/small-business-seo-audit-priorities",
          },
        ],
      },
      {
        heading: "Step 6: transform the audit into an action plan",
        paragraphs: [
          "An audit ends with assigned decisions, not with a list left without follow-up. For each selected action, indicate the page or group of pages concerned, the proof, the planned modification, the person responsible, the dependencies, and how to verify the result. Also keep points awaiting data or expertise in a separate list.",
          "After a modification, first verify that it has been deployed as planned. Depending on the change, then check the URL, content, indexing, or associated metrics. Compare relevant periods and take into account other changes that occurred in the meantime; a temporal evolution does not alone demonstrate that a modification is the cause.",
          "There is no identical frequency for all sites. A migration, an important change, or an observed problem may justify a targeted check; permanent incident tracking belongs more to monitoring. For the first audit, the priority is to document a reproducible method that your team will be able to reuse.",
          "Once the actions are distributed, keep a trace of the postponed elements and the reason for the postponement. This list avoids confusing 'not priority today' with 'verified and without problem'. It also serves as a starting point for the next targeted check, without imposing an identical calendar for all sites.",
        ],
        links: [
          {
            label: "How often should you perform an SEO audit of your site?",
            href: "/resources/website-seo-audit-frequency",
          },
        ],
      },
      {
        heading: "Official sources",
        paragraphs: [
          "The crawl, canonicalization, performance, and search data checks above are based on Google's documentation. Consult the corresponding pages to verify details and potential updates.",
        ],
        links: [
          {
            label: "Search performance report — Search Console Help",
            href: "https://support.google.com/webmasters/answer/7576553?hl=en",
          },
          {
            label: "Introduction to robots.txt — Google Search Central",
            href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=en",
          },
          {
            label: "Sitemaps — Google Search Central",
            href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=en",
          },
          {
            label: "Canonical URL — Google Search Central",
            href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=en",
          },
          {
            label: "Core Web Vitals — Google Search Central",
            href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=en",
          },
          {
            label: "Page experience and search results — Google Search Central",
            href: "https://developers.google.com/search/docs/appearance/page-experience?hl=en",
          },
          {
            label: "URL inspection tool — Search Console Help",
            href: "https://support.google.com/webmasters/answer/9012289?hl=en",
          },
        ],
      },
    ],
    relatedArticles: [],
  },
  RESOURCE_ARTICLE_CHECKLIST,
  RESOURCE_ARTICLE_INTERPRETER_AUDIT,
  RESOURCE_ARTICLE_CONTENT_AUDIT,
  RESOURCE_ARTICLE_AUDIT_SEO_PME_PRIORITES,
  RESOURCE_ARTICLE_AUDIT_FREQUENCY,
  RESOURCE_ARTICLE_GUIDE_REFERENCEMENT_LOCAL,
  RESOURCE_ARTICLE_OPTIMISER_GOOGLE_BUSINESS_PROFILE,
  RESOURCE_ARTICLE_AUDIT_SEO_LOCAL,
  RESOURCE_ARTICLE_REFERENCEMENT_GOOGLE_MAPS,
  RESOURCE_ARTICLE_MOTS_CLES_SEO_LOCAL,
  RESOURCE_ARTICLE_PAGES_LOCALES_SEO,
  RESOURCE_ARTICLE_AVIS_GOOGLE_SEO_LOCAL,
  RESOURCE_ARTICLE_SUIVI_REFERENCEMENT_LOCAL,
  RESOURCE_ARTICLE_MONITORING_SEO_GUIDE,
  RESOURCE_ARTICLE_SURVEILLANCE_SITE_WEB_INDICATEURS,
  RESOURCE_ARTICLE_MONITORING_DISPONIBILITE_SITE,
  RESOURCE_ARTICLE_ALERTES_MONITORING_SITE,
  RESOURCE_ARTICLE_SUIVI_PERFORMANCES_SITE_WEB,
  RESOURCE_ARTICLE_MONITORING_SEO_AUTOMATIQUE,
  RESOURCE_ARTICLE_AUDIT_SEO_VS_MONITORING,
  RESOURCE_ARTICLE_CHOISIR_OUTIL_MONITORING_SEO,
  RESOURCE_ARTICLE_REPORTING_SEO_GUIDE,
  RESOURCE_ARTICLE_RAPPORT_SEO_AUTOMATIQUE,
  RESOURCE_ARTICLE_TABLEAU_DE_BORD_SEO_KPI,
  RESOURCE_ARTICLE_RAPPORT_GOOGLE_SEARCH_CONSOLE,
  RESOURCE_ARTICLE_REPORTING_SEO_PME,
  RESOURCE_ARTICLE_RAPPORT_SEO_MENSUEL,
  RESOURCE_ARTICLE_REPORTING_SEO_CLIENT,
  RESOURCE_ARTICLE_CHOISIR_OUTIL_REPORTING_SEO,
  RESOURCE_ARTICLE_ANALYSE_CONCURRENTIELLE_SEO_GUIDE,
  RESOURCE_ARTICLE_IDENTIFIER_CONCURRENTS_SEO,
  RESOURCE_ARTICLE_ANALYSE_MOTS_CLES_CONCURRENTS,
  RESOURCE_ARTICLE_ANALYSE_CONTENU_CONCURRENTS,
  RESOURCE_ARTICLE_BENCHMARK_SEO_INDICATEURS,
  RESOURCE_ARTICLE_ANALYSE_BACKLINKS_CONCURRENTS,
  RESOURCE_ARTICLE_OPPORTUNITES_SEO_CONCURRENCE,
  RESOURCE_ARTICLE_CHOISIR_OUTIL_ANALYSE_CONCURRENTIELLE_SEO,
];

const LOCAL_TEST_ARTICLES: readonly ResourceArticle[] =
  process.env.NODE_ENV === "production"
    ? []
    : [RESOURCE_ARTICLE_CERTIFICATION, RESOURCE_ARTICLE_DRAFT_FIXTURE];

export const RESOURCE_ARTICLES: readonly ResourceArticle[] = [
  ...EDITORIAL_ARTICLES,
  ...LOCAL_TEST_ARTICLES,
];

export function getPublishedResourceArticles(): ResourceArticle[] {
  return RESOURCE_ARTICLES.filter((article) => article.published);
}

export function getProductionResourceArticles(): ResourceArticle[] {
  return RESOURCE_ARTICLES.filter(
    (article) => article.published && !article.testOnly,
  );
}

export function getResourceArticle(slug: string): ResourceArticle | undefined {
  const lookupSlug = LEGACY_RESOURCE_SLUGS[slug] || slug;
  return RESOURCE_ARTICLES.find(
    (article) => article.slug === lookupSlug && article.published,
  );
}

export function getResourceArticleFromPath(
  pathname: string,
): ResourceArticle | undefined {
  const prefixes = [`${RESOURCE_HUB_PATH}/`, "/ressources/"];
  const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return undefined;

  const encodedSlug = pathname.slice(prefix.length);
  if (!encodedSlug || encodedSlug.includes("/")) return undefined;

  try {
    return getResourceArticle(decodeURIComponent(encodedSlug));
  } catch {
    return undefined;
  }
}

export function getResourceArticlePath(slug: string): string {
  return `${RESOURCE_HUB_PATH}/${encodeURIComponent(ENGLISH_RESOURCE_SLUGS[slug] || slug)}`;
}

export function toEnglishResourcePath(href: string): string {
  const match = href.match(/^(?:\/ressources|\/resources)\/([^/?#]+)(.*)$/);
  if (!match) return href.replace(/^\/ressources(?=\/|$)/, RESOURCE_HUB_PATH);
  try {
    const slug = decodeURIComponent(match[1]);
    const englishSlug = ENGLISH_RESOURCE_SLUGS[LEGACY_RESOURCE_SLUGS[slug] || slug] || slug;
    return `${RESOURCE_HUB_PATH}/${encodeURIComponent(englishSlug)}${match[2]}`;
  } catch {
    return href;
  }
}

export function getResourceArticleCanonical(slug: string): string {
  return `${RESOURCE_SITE_URL}${getResourceArticlePath(slug)}`;
}
