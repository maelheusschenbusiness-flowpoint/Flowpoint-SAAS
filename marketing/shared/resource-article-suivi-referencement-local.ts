import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_SUIVI_REFERENCEMENT_LOCAL: ResourceArticle = {
  slug: "suivi-referencement-local",
  title: "Local SEO Tracking: Measuring Your Maps Visibility | Flowpoint",
  metaDescription:
    "Track local searches with defined points and queries, distinguish Maps metrics from Search Console, and avoid over-interpreting results.",
  h1: "Local SEO Tracking: How to Measure Your Visibility on Google Maps?",
  cluster: "Local SEO",
  parentLanding: "/local-seo",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Flowpoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "Tracking local SEO consists of observing defined signals over time and in areas that matter to your business. A Google Maps position is not a fixed rank valid for an entire city: distance, the query, and context can change the displayed results.",
        "Useful tracking distinguishes between observed positions, profile data, site performance, and business actions. None of these indicators, taken alone, represent total local visibility or demonstrate the number of customers obtained.",
      ],
    },
    {
      heading: "Define what you want to measure",
      paragraphs: [
        "First, choose a question: does your profile receive interactions? Which site pages appear for local searches? Does observed visibility vary depending on the locations where you serve your customers? Are calls or requests evolving? Each question requires a different source and method.",
        [
          "Note the establishments, services, queries, and areas actually concerned. Do not select an entire city if the business does not serve it. To build a list of relevant phrases, consult the guide on ",
          {
            label: "local SEO keywords",
            href: "/ressources/mots-cles-seo-local",
          },
          ".",
        ],
      ],
    },
    {
      heading: "Measure positions from defined points",
      paragraphs: [
        "A team can establish a few representative points in the served area and record the same queries from these points at comparable dates. Log the location, query, date, device, and method used. If you use a third-party tracking tool, check its terms of service and understand how it determines the search location.",
        "A geographic grid is an observation method chosen by the team, not an official Google metric and not a guarantee that every person near a point sees the same result. Limit the number of points to those that answer a concrete question; multiplying points does not turn an imperfect measurement into an exhaustive view.",
        [
          "The guide on ",
          {
            label: "Google Maps SEO",
            href: "/ressources/referencement-google-maps",
          },
          " explains why local results can vary based on the search and distance.",
        ],
      ],
    },
    {
      heading: "Distinguish between Google Business Profile and Search Console data",
      paragraphs: [
        "Google Business Profile can display searches, views, and interactions like calls, clicks to the site, or direction requests, depending on the metrics available for the establishment. Google indicates that only applicable metrics are presented; some data may be updated with a delay. Some performance report measures may also include interactions from organic search and Google Ads.",
        "Search Console describes site performance in Google Search: queries, pages, clicks, and impressions available. This data is not a log of Maps positions at different points and does not replace the analysis of a conversion path. Use a source for the question it answers.",
        "For a quote request, a received call, or a sale, use a separate measure if it is configured and verify that it works. A click on a call button is not necessarily a completed call; an impression or a position does not prove that a person has become a customer.",
      ],
    },
    {
      heading: "Compare periods and competitors with caution",
      paragraphs: [
        "Compare periods that cover relevant durations and conditions. Note changes to the profile, site, offer, or season that can help interpret a variation. A rise or fall observed after a modification does not by itself establish a cause-and-effect link.",
        "A competitive comparison only makes sense if the query, geographic point, date, and method are comparable. Visible results do not reveal the data, history, or all the reasons explaining another establishment's presence. Use them as context to verify, not as proof that a competitor's action caused their rank.",
      ],
    },
    {
      heading: "Build a readable tracking table",
      paragraphs: [
        "Keep only the fields necessary to repeat the observation and decide on the next step. For example:",
      ],
      bullets: [
        "tracked question, establishment, service, and actual area;",
        "query, search point, date, and measurement method;",
        "source and metric: observed position, site performance, or profile interaction;",
        "changes occurred and data limitations;",
        "next check or decision, with a person responsible.",
      ],
    },
    {
      heading: "Fictional example: a practice that takes appointments",
      paragraphs: [
        "Entirely fictional situation: a practice receives its clients at an address and wants to understand if it is visible in several nearby sectors. The team sets a few points located in its actual area, notes the same queries, and repeats the observations according to a constant method. It tracks the interactions available in the profile and the site clicks or impressions in Search Console separately.",
        "Appointment requests are counted in a distinct source, if it exists. If a position varies depending on the point, the team does not transform it into traffic or a number of new customers. It verifies the data and keeps the context before attributing an explanation.",
      ],
    },
    {
      heading: "Additional resources",
      links: [
        {
          label: "General guide to local SEO",
          href: "/ressources/guide-referencement-local",
        },
        {
          label: "Understanding results on Google Maps",
          href: "/ressources/referencement-google-maps",
        },
        {
          label: "Optimizing your Google Business Profile",
          href: "/ressources/optimiser-google-business-profile",
        },
        {
          label: "Auditing your local visibility",
          href: "/ressources/audit-seo-local",
        },
        {
          label: "Linking local queries to useful pages",
          href: "/ressources/mots-cles-seo-local",
        },
      ],
    },
    {
      heading: "Discover Flowpoint's local SEO page",
      paragraphs: [
        [
          "To consult Flowpoint's presentation on local tracking, visit the ",
          {
            label: "local SEO",
            href: "/local-seo",
          },
          " page.",
        ],
      ],
    },
    {
      heading: "Official sources",
      links: [
        {
          label:
            "Improve your local ranking on Google — Google Business Profile Help",
          href: "https://support.google.com/business/answer/7091?hl=en",
        },
        {
          label:
            "Understand your business performance metrics — Google Business Profile Help",
          href: "https://support.google.com/business/answer/9918094?hl=en",
        },
        {
          label:
            "Search performance report — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7576553?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [],
};
