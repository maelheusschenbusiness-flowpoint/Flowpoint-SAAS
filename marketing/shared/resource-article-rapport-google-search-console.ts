import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_RAPPORT_GOOGLE_SEARCH_CONSOLE: ResourceArticle = {
  slug: "rapport-google-search-console",
  title: "Interpreting Google Search Console Data | Flowpoint",
  metaDescription:
    "Understand clicks, impressions, CTR, and average position in Search Console, along with the effects of filters, aggregations, and anonymized queries.",
  h1: "How to interpret Google Search Console data?",
  cluster: "Reporting SEO",
  parentLanding: "/seo-reporting",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Flowpoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "The Search Console performance report helps examine results associated with a property in Google Search. It is not an exhaustive record of every interaction with a site, nor is it a tool that explains a trend on its own. To interpret it, start by checking the search type, property, dates, and filters.",
      ],
    },
    {
      heading: "Understanding the four main metrics",
      table: {
        caption: "Values answer different questions",
        description:
          "Use Google's definitions when comparing reports or explaining a change.",
        headers: ["Metric", "General reading", "What not to conclude"],
        rows: [
          ["Impressions", "Occurrences where a result associated with the site is displayed according to the result type rules.", "That each impression was noticed or resulted in a visit."],
          ["Clicks", "Clicks recorded from Google results to the site.", "The number of analytics sessions or leads."],
          ["CTR", "Ratio between clicks and impressions within the selected scope.", "The quality of a page without examining query, position, and context."],
          ["Average position", "Average calculated for the report's results and dimensions.", "A fixed rank for every person, query, and location."],
        ],
      },
    },
    {
      heading: "Reading dimensions and aggregation",
      paragraphs: [
        "The report can group data by query, page, country, device, or search appearance. How certain indicators are aggregated, particularly average position, depends on the chosen dimension. A change in filter or grouping level can change the observed value without a page necessarily having changed.",
        "Some queries are not displayed in the tables for privacy reasons. The sum of visible rows may therefore differ from the total indicated elsewhere in the report. Google also documents row and data limits; keep these elements in mind during an export.",
      ],
    },
    {
      heading: "Examining a variation without jumping to causality",
      bullets: [
        "Compare periods of comparable duration and seasonality.",
        "Check if the change affects the entire site, a group of pages, or a few queries.",
        "Examine the device, country, and search type before generalizing.",
        "Record site changes and other known events without treating them as proof.",
      ],
      paragraphs: [
        "A drop in clicks can be linked to several possible factors: demand, search result composition, content evolution, availability, or measurement. Search Console describes observations within its scope; analysis must confront other sources before explaining why.",
      ],
    },
    {
      heading: "Fully fictional example: one page and several queries",
      paragraphs: [
        "A fictional association sees its impressions increase on a group of pages while its clicks evolve differently. It first filters by page and device, verifies the dates, and compares visible queries. It notes that the table does not necessarily display all queries, then formulates questions to examine rather than a definitive explanation. The example is fictional.",
      ],
    },
    {
      heading: "Turning the report into decision support",
      paragraphs: [
        [
          "To present metrics in a dashboard, consult the ",
          { label: "SEO KPI", href: "/ressources/tableau-de-bord-seo-kpi" },
          " guide. The ",
          { label: "general reporting guide", href: "/ressources/reporting-seo-guide" },
          " explains how to distinguish observation from analysis.",
        ],
        [
          "To automate collection without automating conclusions, read ",
          { label: "the automated report guide", href: "/ressources/rapport-seo-automatique" },
          " and the ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " page.",
        ],
      ],
    },
    {
      heading: "Official sources",
      links: [
        {
          label: "Search Results performance report — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7576553?hl=en",
        },
        {
          label: "Definitions of impressions, positions, and clicks — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7042828?hl=en",
        },
        {
          label: "Data filters and limits analysis — Google Search Central",
          href: "https://developers.google.com/search/blog/2022/10/performance-data-deep-dive?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [
    "tableau-de-bord-seo-kpi",
    "rapport-seo-mensuel",
    "reporting-seo-client",
  ],
};
