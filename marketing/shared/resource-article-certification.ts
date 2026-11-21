import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_CERTIFICATION: ResourceArticle = {
  slug: "certification-infrastructure-articles",
  title: "Technical Certification Article | Flowpoint",
  metaDescription:
    "Temporary content used only to verify Flowpoint article and resource infrastructure.",
  h1: "Editorial Infrastructure Certification Article",
  cluster: "Technical Certification",
  parentLanding: "/seo-audit",
  datePublished: "2026-10-07",
  dateModified: "2026-10-07",
  author: "Flowpoint Team",
  published: true,
  testOnly: true,
  content: [
    {
      paragraphs: [
        "This short article is temporary technical content. It serves to verify dynamic routing, SSR rendering, metadata, structured data, and the sitemap.",
      ],
    },
    {
      heading: "Page Checks",
      paragraphs: [
        "This certification page is intended only for the local environment. It is not part of the editorial content to be published.",
      ],
    },
  ],
  relatedArticles: [],
};

export const RESOURCE_ARTICLE_DRAFT_FIXTURE: ResourceArticle = {
  slug: "brouillon-test-non-publie",
  title: "Unpublished Test Draft | Flowpoint",
  metaDescription: "Local fixture to verify the rejection of unpublished articles.",
  h1: "Unpublished Test Draft",
  cluster: "Test Fixture",
  parentLanding: "/seo-audit",
  datePublished: "2026-10-07",
  dateModified: "2026-10-07",
  author: "Flowpoint Team",
  published: false,
  testOnly: true,
  content: [],
  relatedArticles: [],
};
