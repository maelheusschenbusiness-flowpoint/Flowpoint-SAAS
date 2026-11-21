import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_ANALYSE_MOTS_CLES_CONCURRENTS: ResourceArticle = {
  slug: "analyse-mots-cles-concurrents",
  title: "Competitor Keyword Analysis: Method and Limitations | Flowpoint",
  metaDescription:
    "Study the queries and pages visible on your competitors' sites without mistaking third-party volumes for exact data or copying their content.",
  h1: "Competitor Keyword Analysis: Method and Limitations",
  cluster: "SEO Competitor Analysis",
  parentLanding: "/competitor-analysis",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Flowpoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "Competitor keyword analysis seeks to understand which searches appear associated with the visible pages of other sites. It does not provide access to their private Search Console data or their business goals. Third-party tools can suggest queries and estimates, which should be treated as leads to verify.",
        "A useful analysis examines the relationship between query, intent, and page. A long list of terms, without context regarding results or audience, does not say which action would be appropriate for your site.",
      ],
    },
    {
      heading: "Start with a defined scope",
      paragraphs: [
        "Select themes related to your services or content, then identify pages that are actually visible for those searches. Note the country, language, date, and query type. Distinguish an informational question from a vendor comparison or a local search; the relevant content will not necessarily be the same.",
        "Your own Search Console report can show the queries that generate impressions or clicks for your property. Competitor data provided by a third-party tool remains an estimate based on its coverage and methodology.",
      ],
    },
    {
      heading: "Analyze the page rather than collecting terms",
      bullets: [
        "What intent appears to be satisfied by the visible page?",
        "What useful information, proof, or practical steps does it contain?",
        "Does your site have a consistent page for this need?",
        "Would an original answer be useful to your clients and sustainable to maintain?",
      ],
      paragraphs: [
        "Do not imitate the title, structure, or wording of a competitor. Use observation to identify a need, then build an answer based on your own knowledge, data, and experience.",
      ],
    },
    {
      heading: "Fully fictional example: a service query",
      paragraphs: [
        "A fictional firm observes that several pages answer a question about service formalities. It verifies the intent, distinguishes educational pages from booking pages, and asks its specialists what information is accurate for its own clients. It then decides whether there is a useful angle to cover. This scenario is fictional; no volume or ranking is claimed.",
      ],
    },
    {
      heading: "Treat volumes and positions with caution",
      paragraphs: [
        "A volume estimate depends on a provider, their model, and their scope. A position reported by a tool can represent a point-in-time observation or an estimate, not a uniform rank for every person. Compare your property's data in Search Console with the page context, without mixing them with third-party estimates.",
        [
          "To differentiate observed actors, see ",
          { label: "identifying SEO competitors", href: "/ressources/identifier-concurrents-seo" },
          "; for local searches, read our ",
          { label: "local SEO keywords guide", href: "/ressources/mots-cles-seo-local" },
          ".",
        ],
      ],
    },
    {
      heading: "Turn observations into opportunities",
      paragraphs: [
        [
          "The guide on ",
          { label: "SEO opportunities against the competition", href: "/ressources/opportunites-seo-concurrence" },
          " proposes a prioritization method. Find general context in the ",
          { label: "competitor analysis guide", href: "/ressources/analyse-concurrentielle-seo-guide" },
          " and on the ",
          { label: "Competitor Analysis", href: "/competitor-analysis" },
          " page.",
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
          label: "Understanding performance data — Google Search Central",
          href: "https://developers.google.com/search/blog/2022/10/performance-data-deep-dive?hl=en",
        },
        {
          label: "Creating helpful, reliable, people-first content — Google Search Central",
          href: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [
    "identifier-concurrents-seo",
    "analyse-contenu-concurrents",
    "opportunites-seo-concurrence",
  ],
};
