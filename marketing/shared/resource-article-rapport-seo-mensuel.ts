import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_RAPPORT_SEO_MENSUEL: ResourceArticle = {
  slug: "rapport-seo-mensuel",
  title: "Monthly SEO Report: Structure, Method, and Example | Flowpoint",
  metaDescription:
    "Organize a monthly SEO report around the scope, data, changes, limitations, and upcoming actions, without prematurely attributing causes.",
  h1: "Monthly SEO Report: Structure and Example",
  cluster: "SEO Reporting",
  parentLanding: "/seo-reporting",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Flowpoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "A monthly SEO report provides a reading rhythm, but the calendar month is not automatically the best window for every question. It can help share developments, work completed, and upcoming checks, provided that the scope is defined and consistent periods are compared.",
        "Present the findings first. Then add possible explanations and data limitations. End with a verifiable action; do not turn a temporal coincidence into proof that a change caused a variation.",
      ],
    },
    {
      heading: "An easy-to-read report structure",
      table: {
        caption: "Editorial framework for recurring monitoring",
        description:
          "Adapt the sections to the reader's question and the sources actually available.",
        headers: ["Section", "Content to specify", "Useful check"],
        rows: [
          ["Scope", "Property, pages, countries, devices, and period.", "Compare the same scope each time."],
          ["Observations", "Indicators and source of each value.", "Check filters, dates, and configuration."],
          ["Changes", "Site updates and completed work.", "Distinguish between documented date and hypothesis."],
          ["Analysis", "Plausible explanations and missing evidence.", "Do not attribute a cause without verification."],
          ["Actions", "Next step, person in charge, and monitoring method.", "Define how to observe progress."],
        ],
      },
    },
    {
      heading: "Choosing valid comparisons",
      paragraphs: [
        "A comparison can contrast two periods of identical length, one period against a comparable period, or two precisely defined segments. Take into account seasonality, public holidays, migrations, and tracking modifications. If the sample or period does not allow for a stable reading, highlight this and avoid categorical conclusions.",
        "Search Console allows you to choose dates and dimensions, but the values may depend on aggregation and filters. For conversions or revenue, verify the tagging, attribution window, and business source separately.",
      ],
    },
    {
      heading: "Fully fictional example: workshop report",
      paragraphs: [
        "A fictional workshop prepares a monthly note for its service pages. The document indicates the URLs examined, compares a consistent period, lists content changes, and distinguishes between Search Console clicks and requests recorded by the team. It proposes to check one page before extending the modification to the others. This scenario is entirely fictional and does not contain observed results.",
      ],
    },
    {
      heading: "Highlighting decisions and unknowns",
      bullets: [
        "Highlight what has changed since the last report.",
        "Indicate unavailable data or modified metrics.",
        "Associate each recommendation with a finding and a verification.",
        "Keep unfinished actions without presenting them as results.",
      ],
      paragraphs: [
        "A summary page can remain short; details and definitions can follow in an appendix. The important thing is that the reader can trace a value and understand what it does or does not allow them to say.",
      ],
    },
    {
      heading: "Resources related to monthly reporting",
      paragraphs: [
        [
          "For the indicators to include, see the ",
          { label: "SEO dashboard KPIs", href: "/ressources/tableau-de-bord-seo-kpi" },
          " and the ",
          { label: "SEO reporting for SMEs", href: "/ressources/reporting-seo-pme" },
          ". The ",
          { label: "client reporting guide", href: "/ressources/reporting-seo-client" },
          " helps to adapt the level of detail.",
        ],
        [
          "The ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " page describes the Flowpoint offer.",
        ],
      ],
    },
    {
      heading: "Official sources",
      links: [
        {
          label: "Search Performance Report — Search Console Help",
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
    "rapport-google-search-console",
    "reporting-seo-client",
  ],
};
