import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_SURVEILLANCE_SITE_WEB_INDICATEURS: ResourceArticle = {
  slug: "surveillance-site-web-indicateurs",
  title: "Website monitoring: which indicators to track? | Flowpoint",
  metaDescription:
    "Choose availability, performance, indexing, and visibility indicators adapted to your pages, without confusing them or over-interpreting an alert.",
  h1: "Website monitoring: which indicators to track?",
  cluster: "Monitoring SEO",
  parentLanding: "/website-monitoring",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "FlowPoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "A monitoring dashboard quickly becomes noisy when it gathers metrics that do not address the same topic. A useful indicator answers a question, covers a known scope, and triggers a proportionate verification. You should not transform an isolated technical signal into a verdict on SEO.",
        "Before choosing a figure, specify the source, the URL or group of pages, the period, and the collection method. This sheet separates the categories to be followed rather than proposing a global score that would mask their differences.",
      ],
    },
    {
      heading: "Availability: observe the response, not the entire experience",
      paragraphs: [
        "An availability check can verify that a domain or an address responds from a measurement point. Depending on its configuration, it can also track the certificate or a simple step. It does not guarantee that the form, authentication, JavaScript-rendered content, or the complete journey works for every visitor.",
        "Note the received code, the location and network of the check, the tested URL, and the possibility of reproducing the incident. Several concordant observations help to distinguish a site outage from a one-off test issue.",
      ],
    },
    {
      heading: "Performance: distinguish field and lab data",
      paragraphs: [
        "Lab metrics describe a controlled trial; field data reflect aggregated real-world experiences when available. They may differ due to the device, network, cache, or content viewed. Google documents Core Web Vitals as a set of metrics centered on loading experience, interactivity, and visual stability; it is not an exhaustive measure of SEO quality.",
        [
          "For the scope and tools of these metrics, consult ",
          { label: "Web Vitals", href: "https://web.dev/articles/vitals?hl=en" },
          " and our guide on ",
          { label: "web performance monitoring", href: "/ressources/suivi-performances-site-web" },
          ".",
        ],
      ],
    },
    {
      heading: "Indexing and visibility: read the appropriate reports",
      paragraphs: [
        "The Search Console indexing report shows the status known by Google for URLs of the verified site and page examples. URL inspection provides more targeted control. These tools do not monitor availability at every moment and do not constitute a promise of indexing.",
        "The search performance report describes impressions, clicks, CTR, and average position according to the chosen scope. A variation may justify an analysis; it does not reveal its cause on its own. Compare consistent periods and segments before explaining the movement.",
      ],
    },
    {
      heading: "Fully fictional example: organizing a tracking dashboard",
      paragraphs: [
        "A fictional store tracks its checkout page response, performance signals on its product pages, reported indexing states, and organic impression trends separately. Its dashboard associates each check with a source and a person in charge. This scenario is not an observed result.",
        "When an indicator changes, the team opens the corresponding verification instead of adding up heterogeneous measures. This separation avoids confusing \"the page responds,\" \"the page is indexed,\" and \"the page is chosen by internet users.\"",
      ],
    },
    {
      heading: "Choose indicators that lead to action",
      bullets: [
        "Define the risk or the decision that the check should inform.",
        "Track few metrics, but document source, segment, and period.",
        "Plan for independent confirmation before declaring an incident.",
        "Link search trends to an analysis, not a presumed causality.",
      ],
    },
    {
      heading: "Continue with complementary resources",
      paragraphs: [
        [
          "The ",
          { label: "SEO monitoring guide", href: "/ressources/monitoring-seo-guide" },
          " helps to assemble these families of checks; the ",
          { label: "Website Monitoring", href: "/website-monitoring" },
          " page presents the Flowpoint offer.",
        ],
      ],
    },
    {
      heading: "Official sources",
      links: [
        {
          label: "Web Vitals — web.dev",
          href: "https://web.dev/articles/vitals?hl=en",
        },
        {
          label: "Page indexing report — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7440203?hl=en",
        },
        {
          label: "Search performance report — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7576553?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [
    "monitoring-seo-guide",
    "monitoring-disponibilite-site",
    "suivi-performances-site-web",
  ],
};
