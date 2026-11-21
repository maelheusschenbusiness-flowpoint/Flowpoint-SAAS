import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_REPORTING_SEO_CLIENT: ResourceArticle = {
  slug: "reporting-seo-client",
  title: "Client SEO reporting: presenting results with clarity | Flowpoint",
  metaDescription:
    "Present understandable client SEO reporting: scope, sources, findings, limitations, actions, and responsibilities, without promising rankings.",
  h1: "Client SEO reporting: how to present results?",
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
        "A report intended for a client must make findings understandable and verifiable. It explains what was tracked, what changed, what remains uncertain, and what is proposed next. It must not promise a ranking nor present a hypothesis as a settled result.",
        "Adapt the level of detail to the recipient, without removing the source or the definition of a metric. A summary can be short; the elements necessary to verify it must remain accessible.",
      ],
    },
    {
      heading: "Start with the agreed scope",
      paragraphs: [
        "Recall the objectives, pages, and markets covered, the sources used, and the comparison dates. Distinguish the work completed from the measured changes. If the scope has changed or an integration has not collected data, state this before comparing figures.",
        "Separate visibility indicators from sessions, configured conversions, and sales. A sale may depend on multiple channels and steps; an SEO table does not automatically prove that a given action caused it.",
      ],
    },
    {
      heading: "Present the finding, then the interpretation",
      bullets: [
        "State what the source measures, with its period and filters.",
        "Name confirmed changes and hypotheses to be investigated separately.",
        "Explain the limitations, particularly queries or segments that are not visible.",
        "Link the recommendation to a page, a question, and a future check.",
      ],
      paragraphs: [
        "Avoid charts where axes or dates are hidden, percentages without reference values, and comparisons that mix properties. If the impact is not yet measurable, formulate a next step rather than a premature conclusion.",
      ],
    },
    {
      heading: "Fully fictional example: presenting a drop in clicks",
      paragraphs: [
        "A fictional agency notices a drop in clicks on a client's pages. It indicates the period and Search Console filters, distinguishes the affected pages from the others, then checks recent modifications and available data. It proposes a diagnostic before any rewriting. This scenario is fictional and does not constitute a client result.",
        "The presentation thus protects trust: the client sees the signal, the limit of interpretation, and the next decision instead of a promise of a quick return.",
      ],
    },
    {
      heading: "Agree on actions and responsibilities",
      paragraphs: [
        "Each action must specify who performs it, which page or data it concerns, and how the tracking will be done. The agency may recommend a check or an improvement; the client may provide business information or validate content. List dependencies and pending tasks separately.",
        [
          "The ",
          { label: "monthly SEO report", href: "/ressources/rapport-seo-mensuel" },
          " provides a framework; the ",
          { label: "reporting guide", href: "/ressources/reporting-seo-guide" },
          " distinguishes findings, analysis, and decisions.",
        ],
      ],
    },
    {
      heading: "Choose a format that allows for dialogue",
      paragraphs: [
        "Prepare a summary for the meeting and keep tables, definitions, and filters as a supplement. Invite the recipient to clarify a business priority or a data limitation; a report does not replace this context.",
        [
          "To select indicators, consult the ",
          { label: "SEO dashboard KPIs", href: "/ressources/tableau-de-bord-seo-kpi" },
          " and the guide on ",
          { label: "Search Console", href: "/ressources/rapport-google-search-console" },
          ".",
        ],
      ],
    },
    {
      heading: "Discover Flowpoint's SEO reporting",
      paragraphs: [
        [
          "The ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " page describes the service offering. Confirm the scope and available data before relying on a tool in a client engagement.",
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
          label: "Limitations of performance data — Google Search Central",
          href: "https://developers.google.com/search/blog/2022/10/performance-data-deep-dive?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [
    "reporting-seo-guide",
    "rapport-seo-mensuel",
    "choisir-outil-reporting-seo",
  ],
};
