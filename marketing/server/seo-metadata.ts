import {
  SEO_CLUSTER_CONTENT,
  type SeoClusterPath,
} from "@shared/seo-cluster-content";
import {
  getResourceArticleCanonical,
  getResourceArticleFromPath,
  RESOURCE_SITE_URL,
  type ResourceArticle,
} from "@shared/resource-articles";
import {
  buildFaqPageJsonLd,
  buildResourcesItemListJsonLd,
  PRICING_FAQS,
  getPricingFaqs,
  SEO_AUDIT_FAQS,
  FREE_SEO_AUDIT_FAQS,
} from "@shared/structured-data-content";
import { HOME_PAGE_TITLE } from "@shared/site-metadata";
import { HOME_FAQS } from "@shared/home-faqs";
import { normalizeMarketingLanguage } from "@shared/marketing-language";

export interface RouteMetadata {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  noindex?: boolean;
}

const BASE_URL = RESOURCE_SITE_URL;
const DEFAULT_OG_IMAGE = `${BASE_URL}/social-cover.png`;
const SITE_NAME = "FlowPoint";
const LEGACY_TO_ENGLISH_PATH: Record<string, string> = {
  "/merci": "/thank-you",
  "/a-propos": "/about",
  "/carrieres": "/careers",
  "/mentions-legales": "/legal-notice",
  "/informations-legales": "/legal-information",
  "/mises-a-jour": "/updates",
  "/ressources": "/resources",
  "/fonctionnalites": "/features",
  "/tarifs": "/pricing",
  "/avantages": "/benefits",
};
const ENGLISH_TO_LEGACY_PATH = Object.fromEntries(
  Object.entries(LEGACY_TO_ENGLISH_PATH).map(([legacy, english]) => [english, legacy]),
);

export const ROUTE_METADATA: Record<string, RouteMetadata> = {
  "/": {
    title: HOME_PAGE_TITLE,
    description:
      "FlowPoint is a SaaS workspace for SEO, local search, competitor analysis, website monitoring, analytics, reporting and AI-supported recommendations for teams.",
    canonical: `${BASE_URL}/`,
  },
  "/fonctionnalites": {
    title: "FlowPoint Platform Features for SEO & Digital Growth",
    description:
      "Explore FlowPoint's SEO audits, local search, competitor analysis, website monitoring, analytics, reporting, and AI-supported recommendations in one workspace.",
    canonical: `${BASE_URL}/fonctionnalites`,
  },
  "/seo-audit": {
    title: "SEO Audit Software for Website Analysis | FlowPoint",
    description:
      "Find technical SEO issues, review on-page content and prioritize practical fixes with FlowPoint. Turn your website audit into clear next steps for your team.",
    canonical: `${BASE_URL}/seo-audit`,
  },
  "/free-seo-audit": {
    title: "Free Website SEO Audit, One Page at a Time | FlowPoint",
    description:
      "Check one public page for its title, meta description, canonical and indexing signals, and sampled links. Get a clear free report with no account required.",
    canonical: `${BASE_URL}/free-seo-audit`,
  },
  "/local-seo": {
    title: "Local SEO Software for Google Maps Rankings | FlowPoint",
    description:
      "Track local SEO with FlowPoint across Google Maps positions, Google Business Profile data, local keywords and competitors. Prioritize visibility by location.",
    canonical: `${BASE_URL}/local-seo`,
  },
  "/website-monitoring": {
    title: "Website Monitoring Software for Uptime and SEO | FlowPoint",
    description:
      "Monitor website uptime, SSL, latency, endpoints and Core Web Vitals with FlowPoint. Detect important changes and connect technical signals to SEO priorities.",
    canonical: `${BASE_URL}/website-monitoring`,
  },
  "/seo-reporting": {
    title: "SEO Reporting Software for Agencies and Teams | FlowPoint",
    description:
      "Bring SEO performance, keywords, local visibility and recommendations together in clear, shareable reports for agency teams and client updates with FlowPoint.",
    canonical: `${BASE_URL}/seo-reporting`,
  },
  "/competitor-analysis": {
    title: "SEO Competitor Analysis Tool for Rankings | FlowPoint",
    description:
      "Compare competitor rankings, keywords and local visibility with FlowPoint. Find search gaps and prioritize practical SEO actions for your business or agency.",
    canonical: `${BASE_URL}/competitor-analysis`,
  },
  "/tarifs": {
    title: "SEO & Digital Growth Software Pricing & Plans | FlowPoint",
    description:
      "Compare FlowPoint plans for SEO audits, local search, monitoring and reporting. Choose Starter, Pro or Agency with no commitment and a 14-day free trial.",
    canonical: `${BASE_URL}/tarifs`,
  },
  "/avantages": {
    title: "Benefits | FlowPoint",
    description:
      "See how FlowPoint connects SEO insights, local search, monitoring and reporting to support clearer online-growth decisions.",
    canonical: `${BASE_URL}/avantages`,
  },
  "/ressources": {
    title: "SEO & Digital Growth Resources and Guides | FlowPoint",
    description:
      "Browse guides on SEO audits, local search, website monitoring, SEO reporting and competitor analysis. Find practical steps for search visibility and growth.",
    canonical: `${BASE_URL}/ressources`,
  },
  "/a-propos": {
    title: "About FlowPoint | Digital-Growth Platform",
    description:
      "Learn about FlowPoint, a digital-growth SaaS workspace connecting SEO analysis, local search, website monitoring, competitor insights, analytics, and reporting for businesses and their teams.",
    canonical: `${BASE_URL}/a-propos`,
  },
  "/contact": {
    title: "Contact | FlowPoint",
    description:
      "Have a question or a project? Contact the FlowPoint team. We are here to support your digital growth.",
    canonical: `${BASE_URL}/contact`,
  },
  "/carrieres": {
    title: "Careers | FlowPoint",
    description:
      "Join FlowPoint and help businesses improve their online presence through connected digital-growth tools.",
    canonical: `${BASE_URL}/carrieres`,
  },
  "/mentions-legales": {
    title: "Legal Notice | FlowPoint",
    description:
      "FlowPoint legal notice: website publisher, hosting, intellectual property, and personal data.",
    canonical: `${BASE_URL}/mentions-legales`,
  },
  "/informations-legales": {
    title: "Legal Information | FlowPoint",
    description:
      "FlowPoint terms of use, privacy policy, and legal information in one place.",
    canonical: `${BASE_URL}/informations-legales`,
  },
  "/mises-a-jour": {
    title: "Updates | FlowPoint",
    description:
      "Explore the latest FlowPoint features and improvements across SEO, monitoring, analytics, local search, reporting, and AI workflows.",
    canonical: `${BASE_URL}/mises-a-jour`,
  },
  "/merci": {
    title: "Thank You | FlowPoint",
    description:
      "Thank you for signing up for FlowPoint. Discover how its connected digital-growth tools can support your work.",
    noindex: true,
  },
};

function buildClusterFaqJsonLd(path: SeoClusterPath): object {
  const content = SEO_CLUSTER_CONTENT[path];

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function buildResourceArticleJsonLd(article: ResourceArticle): object {
  const canonical = getResourceArticleCanonical(article.slug);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.h1,
    description: article.metaDescription,
    image: DEFAULT_OG_IMAGE,
    author: {
      "@type": "Organization",
      name: article.author,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: `${BASE_URL}/`,
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/favicon.svg?v=2`,
      },
    },
    datePublished: article.datePublished,
    dateModified: article.dateModified,
    articleSection: article.cluster,
    inLanguage: "en",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical,
    },
  };
}

function buildResourceArticleBreadcrumbJsonLd(
  article: ResourceArticle,
): object {
  const canonical = getResourceArticleCanonical(article.slug);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${BASE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Resources",
        item: `${BASE_URL}/resources`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: article.h1,
        item: canonical,
      },
    ],
  };
}

export const ROUTE_JSON_LD: Record<string, object> = {
  "/": buildFaqPageJsonLd(HOME_FAQS),
  "/seo-audit": buildFaqPageJsonLd(SEO_AUDIT_FAQS),
  "/free-seo-audit": buildFaqPageJsonLd(FREE_SEO_AUDIT_FAQS),
  "/local-seo": buildClusterFaqJsonLd("/local-seo"),
  "/website-monitoring": buildClusterFaqJsonLd("/website-monitoring"),
  "/seo-reporting": buildClusterFaqJsonLd("/seo-reporting"),
  "/competitor-analysis": buildClusterFaqJsonLd("/competitor-analysis"),
  "/tarifs": buildFaqPageJsonLd(PRICING_FAQS),
  "/ressources": buildResourcesItemListJsonLd(),
};

export const NOT_FOUND_METADATA: RouteMetadata = {
  title: "Page introuvable | FlowPoint",
  description: "Cette page n'existe pas ou a été déplacée.",
  noindex: true,
};

function getRouteMetadata(pathname: string): RouteMetadata {
  const metadata = ROUTE_METADATA[pathname] || ROUTE_METADATA[ENGLISH_TO_LEGACY_PATH[pathname]];
  if (metadata) {
    const canonicalPath = LEGACY_TO_ENGLISH_PATH[pathname] || pathname;
    return { ...metadata, canonical: `${BASE_URL}${canonicalPath}` };
  }

  const article = getResourceArticleFromPath(pathname);
  if (!article) return NOT_FOUND_METADATA;

  return {
    title: article.title,
    description: article.metaDescription,
    canonical: getResourceArticleCanonical(article.slug),
    ogType: "article",
    noindex: article.testOnly,
  };
}

function getRouteJsonLd(pathname: string, language?: string): object[] {
  if (
    language?.toLowerCase() === "fr" &&
    (pathname === "/pricing" || pathname === "/tarifs")
  ) {
    return [buildFaqPageJsonLd(getPricingFaqs("fr"))];
  }
  const staticJsonLd = ROUTE_JSON_LD[pathname] || ROUTE_JSON_LD[ENGLISH_TO_LEGACY_PATH[pathname]];
  if (staticJsonLd) return [staticJsonLd];

  const article = getResourceArticleFromPath(pathname);
  if (!article) return [];

  return [
    buildResourceArticleJsonLd(article),
    buildResourceArticleBreadcrumbJsonLd(article),
  ];
}

export function buildHeadTags(meta: RouteMetadata): string {
  const ogImage = meta.ogImage ?? DEFAULT_OG_IMAGE;
  const tags = [
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
  ];
  if (meta.noindex) {
    tags.push(`<meta name="robots" content="noindex,follow" />`);
  }
  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`);
  }
  tags.push(
    `<meta property="og:type" content="${meta.ogType ?? "website"}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
  );
  if (meta.canonical) {
    tags.push(`<meta property="og:url" content="${escapeAttr(meta.canonical)}" />`);
  }
  tags.push(
    `<meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`,
  );
  if (meta.canonical) {
    tags.push(
      `<link rel="alternate" hreflang="en" href="${escapeAttr(meta.canonical)}" />`,
      `<link rel="alternate" hreflang="x-default" href="${escapeAttr(meta.canonical)}" />`,
    );
  }
  return tags.join("\n    ");
}

export function injectMetadata(
  html: string,
  pathname: string,
  displayedLanguage?: string,
): string {
  const meta = getRouteMetadata(pathname);

  const titleTag = `<title>${escapeHtml(meta.title)}</title>`;
  const headTags = buildHeadTags(meta);

  let result = html.replace(/<title>[^<]*<\/title>/, titleTag);
  if (pathname === "/pricing" || pathname === "/tarifs") {
    const language = normalizeMarketingLanguage(displayedLanguage) || "en";
    result = result.replace(/<html\b([^>]*)>/i, (_tag, attributes: string) => {
      const withoutLanguage = attributes.replace(
        /\s+lang=(?:"[^"]*"|'[^']*')/i,
        "",
      );
      return `<html${withoutLanguage} lang="${language}">`;
    });
  }

  const headCloseIdx = result.lastIndexOf("</head>");
  if (headCloseIdx === -1) return result;

  const jsonLdTags = getRouteJsonLd(pathname, displayedLanguage)
    .map(
      (jsonLd) =>
        `\n    <script type="application/ld+json" data-json-ld="true">${JSON.stringify(jsonLd)}</script>`,
    )
    .join("");

  return (
    result.slice(0, headCloseIdx) +
    `    ${headTags}${jsonLdTags}\n  </head>` +
    result.slice(headCloseIdx + 7)
  );
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
