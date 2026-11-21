import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_REPORTING_SEO_PME: ResourceArticle = {
  slug: "reporting-seo-pme",
  title: "SEO reporting for SMEs: key indicators | Flowpoint",
  metaDescription:
    "Prepare an SEO report tailored to an SME: objectives, defined indicators, sources, limitations, and concrete decisions.",
  h1: "SEO reporting for SMEs: which indicators to present?",
  cluster: "Reporting SEO",
  parentLanding: "/seo-reporting",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "FlowPoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "An SME does not need a bulky report to steer SEO. The document must help a person understand what has been observed, what remains uncertain, and which action deserves time. Start with the company's objectives and the pages linked to its offerings, not with the list of metrics proposed by a tool.",
        "Choose a few understandable indicators, but keep a definition and a source for each. A short, traceable table is more useful than an overall score that aggregates incompatible data.",
      ],
    },
    {
      heading: "Choosing measures according to activity",
      paragraphs: [
        "A service company can track impressions and clicks from service pages, visits measured by its analytics tool, and requests actually received. An online store may need segments of product pages and configured events. These examples are categories of measurement: the actual results depend on the configuration and objectives of each company.",
      ],
      bullets: [
        "Visibility in search: impressions, clicks, or queries in Search Console.",
        "Behavior on the site: sessions or events according to the configured analytics tool.",
        "Business result: qualified leads, sales, or calls logged in a dedicated source.",
      ],
    },
    {
      heading: "Presenting context and limitations",
      paragraphs: [
        "Indicate the period, pages, and segments compared. Search Console describes search results within its scope; analytics events depend on tagging and configuration; commercial information comes from another system. Differences in date, attribution, or definition can prevent an exact match.",
        "A variation is a finding, not necessarily an explanation. Add known site changes and hypotheses to be verified, without presenting them as proof of causality.",
      ],
    },
    {
      heading: "Entirely fictional example: a short report",
      paragraphs: [
        "A fictional repair SME presents monthly clicks from service pages in Search Console, forms recorded on its site, and qualified requests in its tracking tool. It adds a note on the dates compared and explains that these sources do not all attribute requests to SEO. The scenario is fictional and reports no client results.",
      ],
    },
    {
      heading: "Proposing a realistic decision",
      paragraphs: [
        "End the report with an action featuring a lead and a follow-up check: updating a page, verifying a conversion, or examining a targeted drop. If the data is insufficient, suggest fixing the measurement first rather than recommending a strategy on an uncertain basis.",
        [
          "To structure these measures, consult the guide on ",
          { label: "SEO KPIs", href: "/ressources/tableau-de-bord-seo-kpi" },
          ", then use the ",
          { label: "monthly report format", href: "/ressources/rapport-seo-mensuel" },
          ".",
        ],
      ],
    },
    {
      heading: "Continue with the reporting guide",
      paragraphs: [
        [
          "The ",
          { label: "general SEO reporting guide", href: "/ressources/reporting-seo-guide" },
          " distinguishes between measurement, analysis, and decision. The ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " page presents Flowpoint's commercial offering.",
        ],
      ],
    },
    {
      heading: "Official sources",
      links: [
        {
          label: "Search performance report — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7576553?hl=en",
        },
        {
          label: "Definitions of impressions, positions, and clicks — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7042828?hl=en",
        },
        {
          label: "Performance data limitations — Google Search Central",
          href: "https://developers.google.com/search/blog/2022/10/performance-data-deep-dive?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [
    "reporting-seo-guide",
    "tableau-de-bord-seo-kpi",
    "rapport-seo-mensuel",
  ],
};
