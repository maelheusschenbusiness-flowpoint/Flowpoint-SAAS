import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_TABLEAU_DE_BORD_SEO_KPI: ResourceArticle = {
  slug: "tableau-de-bord-seo-kpi",
  title: "SEO Dashboard: Choosing Useful KPIs | Flowpoint",
  metaDescription:
    "Choose SEO KPIs linked to your goals and separate visibility, clicks, conversions, and revenue into a readable dashboard.",
  h1: "SEO Dashboard: Which KPIs to Track?",
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
        "An SEO dashboard does not need to display all available data. It must show the indicators necessary for a decision, with their definition, source, and scope. The selected KPIs depend on the site's goal and the dashboard's intended audience.",
        "Avoid presenting visibility, traffic, conversion, and revenue as a single measure. An increase in impressions does not prove an increase in clicks; a visit is not a conversion; an attributed conversion does not always provide a complete explanation of revenue.",
      ],
    },
    {
      heading: "Organizing KPIs by Level",
      table: {
        caption: "A chain of metrics, not a single SEO score",
        description:
          "Each level requires an adapted source and an explicit definition.",
        headers: ["Level", "Examples of measures", "Precaution"],
        rows: [
          ["Search visibility", "Search Console impressions and average position.", "Dimensions, groupings, and filters influence interpretation."],
          ["Search visits", "Search Console clicks or sessions measured in analytics.", "Sources and definitions of clicks/sessions differ."],
          ["Tracked actions", "Event or goal configured in an analytics tool.", "Measurement depends on implementation and consent."],
          ["Commercial result", "Qualified leads or sales recorded in a business tool.", "Attribution does not prove that SEO is the sole cause."],
        ],
      },
    },
    {
      heading: "Adapting the Dashboard to the Question",
      paragraphs: [
        "For an editorial page, queries, clicks, and visit quality can shed light on different priorities. For a local service, geographic scope and actual requests may count for more. In both cases, conversions require tracking defined separately from Search Console.",
        "Choose one primary metric and a few diagnostic metrics rather than an endless list. Add a note whenever a property, campaign, or event has changed.",
      ],
    },
    {
      heading: "Fully Fictional Example: SME Dashboard",
      paragraphs: [
        "A fictional SME tracks a series of service pages. Its dashboard separates impressions and clicks from Search Console, forms correctly registered by its analytics tool, and requests validated by the sales team. It avoids adding these values together or presenting every request as revenue attributed to SEO. This scenario is fictional and contains no real results.",
      ],
    },
    {
      heading: "Checking Definitions and Data",
      bullets: [
        "Document properties, filters, countries, devices, periods, and groupings.",
        "Verify that events or conversions are working before interpreting them.",
        "Explain missing, anonymized, or aggregated data.",
        "Compare consistent periods and note measurement changes.",
      ],
      paragraphs: [
        "In Search Console, position is an average calculated according to the reporting method; it does not correspond to a fixed position valid for every search or user. Dashboards may not display all queries. Present the limitations near the relevant figure.",
      ],
    },
    {
      heading: "Continuing to Reporting and Analysis",
      paragraphs: [
        [
          "The ",
          { label: "SEO reporting guide", href: "/ressources/reporting-seo-guide" },
          " explains how to move from measurement to decision. For search data, consult the guide on ",
          { label: "Google Search Console", href: "/ressources/rapport-google-search-console" },
          " and the ",
          { label: "SEO reporting for SMEs", href: "/ressources/reporting-seo-pme" },
          ".",
        ],
      ],
    },
    {
      heading: "Discover the SEO Reporting Page",
      paragraphs: [
        [
          "The commercial page ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " presents Flowpoint's proposal; verify that the available data matches your KPIs.",
        ],
      ],
    },
    {
      heading: "Official Sources",
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
    "reporting-seo-pme",
    "rapport-seo-mensuel",
  ],
};
