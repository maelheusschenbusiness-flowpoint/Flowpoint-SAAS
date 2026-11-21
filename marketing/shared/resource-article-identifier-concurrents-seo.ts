import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_IDENTIFIER_CONCURRENTS_SEO: ResourceArticle = {
  slug: "identifier-concurrents-seo",
  title: "How to identify your SEO competitors? | Flowpoint",
  metaDescription:
    "Distinguish between commercial competitors and those visible in Google, then build an SEO list linked to your queries, audiences, and regions.",
  h1: "How to identify your SEO competitors?",
  cluster: "Analyse concurrentielle SEO",
  parentLanding: "/competitor-analysis",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "FlowPoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "The list of a company's competitors is not automatically the list of sites that compete with it in search. A customer might compare direct offers while Google also displays directories, media, marketplaces, or explanatory pages. SEO analysis focuses on the results visible for a defined set of queries.",
        "This distinction makes benchmarking more precise: instead of asking \"who are our competitors?\", ask \"which pages currently answer these searches and what needs do they cover?\"",
      ],
    },
    {
      heading: "Separating two families of competitors",
      table: {
        caption: "Two lists useful to keep separately",
        description:
          "The same organization can belong to both families, one, or neither depending on the scope.",
        headers: ["Family", "Working definition", "Identification source"],
        rows: [
          ["Commercial", "Company or offer that the public might choose instead of yours.", "Market knowledge, offers, and customer feedback."],
          ["SEO", "Domain or page visible on the selected organic queries.", "SERP observation, research tools, and your data."],
        ],
      },
    },
    {
      heading: "Building a sample of searches",
      paragraphs: [
        "Choose queries representative of your services, content, and audiences. Group them by intent — to learn, compare, find a provider, or perform an action — then specify the useful countries or areas. A directory page can be a result competitor for a query while not being a rival company.",
        "SERPs evolve according to the query, context, and time period; an isolated observation does not establish a lasting presence. Note the date and method, then look for common patterns before deciding that a domain deserves in-depth analysis.",
      ],
    },
    {
      heading: "Fully fictional example: a tutoring company",
      paragraphs: [
        "A fictional language school first considers other schools as its commercial competitors. By observing learning queries, it also sees dictionaries and editorial sites. It keeps the two lists separate: schools for studying offers, and visible pages for understanding formats and needs in the results. The example is entirely fictional.",
      ],
    },
    {
      heading: "Validate before comparing",
      bullets: [
        "Verify that the page answers a comparable intent.",
        "Distinguish the domain from the actually visible URL.",
        "Note the location, date, device, and observed query.",
        "Avoid treating ads or special results as classic organic positions.",
      ],
      paragraphs: [
        "Once the list is built, compare the pages that count rather than entire domains. Content, result type, and audience can vary strongly from one section to another.",
      ],
    },
    {
      heading: "Continue the analysis",
      paragraphs: [
        [
          "The ",
          { label: "complete competitive analysis guide", href: "/ressources/analyse-concurrentielle-seo-guide" },
          " helps to organize the steps. To examine queries, consult the ",
          { label: "competitor keyword analysis", href: "/ressources/analyse-mots-cles-concurrents" },
          " and the ",
          { label: "benchmark indicators", href: "/ressources/benchmark-seo-indicateurs" },
          ".",
        ],
        [
          "The ",
          { label: "Competitor Analysis", href: "/competitor-analysis" },
          " page presents Flowpoint's commercial offer.",
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
          label: "Create helpful, reliable, people-first content — Google Search Central",
          href: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [
    "analyse-concurrentielle-seo-guide",
    "analyse-mots-cles-concurrents",
    "opportunites-seo-concurrence",
  ],
};
