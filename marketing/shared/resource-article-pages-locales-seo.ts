import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_PAGES_LOCALES_SEO: ResourceArticle = {
  slug: "pages-locales-seo",
  title: "Local SEO Pages: Avoiding Duplicate Content | Flowpoint",
  metaDescription:
    "Decide when to create a local page, what area-specific information to include, and how to avoid nearly identical or doorway pages.",
  h1: "Local SEO Pages: How to create useful pages without duplication?",
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
        "A local page deserves to exist when it helps a visitor understand a service available in a physical location. Adding a city name to a generic page is not enough to make its content specific. Before creating one, verify that the company actually serves the area and that it can provide useful information that is more than just a name variation.",
        "The editorial goal is to address a clear local intent without suggesting that an establishment exists where the company does not receive clients. Google prohibits the abusive use of doorway pages designed to target similar geographic queries and direct users to a destination of little utility.",
      ],
    },
    {
      heading: "When is a local page justified?",
      paragraphs: [
        "A page can be relevant if it describes a physical establishment, a served area with specific conditions, or a service whose terms vary by location. It must help the person decide what to do: where to go, if an intervention is possible, what the service limits are, or how to contact the team.",
        "If the company does not serve a city, does not have an establishment there, and has no distinct information to communicate, the name of that city alone does not justify a page. A general page describing the actual service area may be more useful.",
      ],
    },
    {
      heading: "Providing specific and verifiable information",
      paragraphs: [
        "Before writing, gather information the company can confirm: address and access, establishment-specific hours, services actually available, intervention constraints, appointment procedures, or details useful to the visitor. Do not add testimonials, projects, or local presence that does not exist.",
        "A page can follow a site-wide structure, but its main content must reflect the specific service and location. Replacing only the town name, the service title, or a few adjectives in an identical text does not answer a different local query.",
      ],
    },
    {
      heading: "Building an easy-to-use page",
      paragraphs: [
        "Present the service and the location first, then the details that allow the visitor to verify that it meets their needs. Depending on the case, this can include hours, travel conditions, an address truly open to the public, contact methods, or differences in the offering. Only include relevant and up-to-date elements.",
        "Link the page to the general service page, useful navigation, and, if it exists, the corresponding establishment page. Links must help visitors continue their journey; avoid endless lists of cities that all lead to the same destination.",
        [
          "To organize the searches that a page should answer, consult the guide on ",
          {
            label: "local SEO keywords",
            href: "/ressources/mots-cles-seo-local",
          },
          ".",
        ],
      ],
    },
    {
      heading: "Avoiding duplication and doorway pages",
      paragraphs: [
        "Google defines the abusive use of doorway pages as the creation of pages or sites to rank for similar specific queries, then sending users to an intermediate page that is less useful. Its examples include pages targeting multiple cities and funneling visitors to the same destination.",
        "The risk is not just about a percentage of identical text. Ask yourself if each page addresses a distinct need, if its location is real, if useful information is present on the landing page, and if a visitor can take action without passing back through a generic page. If several pages differ only by city name, group the information or rewrite the architecture before publishing them.",
      ],
    },
    {
      heading: "Two fictional examples: a useful page and an artificial page",
      paragraphs: [
        "The situations in the table are entirely fictional and serve to illustrate an editorial decision, not to describe an existing site.",
      ],
      table: {
        caption: "Fictional examples of decisions on local pages.",
        description:
          "A local page must correspond to an offer and information that the company can verify.",
        headers: ["Fictional situation", "Elements to verify", "Editorial guidance"],
        rows: [
          [
            "A company opens a physical workshop in a new town.",
            "Address open to the public, hours, services offered on-site, access, and contact.",
            "An establishment page can be useful if it gathers this information and facilitates the visit.",
          ],
          [
            "A company replaces the city name in identical text for many towns.",
            "Existence of a real service in each zone, distinct details, and utility of each page.",
            "Do not publish the series automatically; create a general page or produce only the pages that address a different need.",
          ],
        ],
      },
    },
    {
      heading: "Revising pages when business changes",
      paragraphs: [
        [
          "An area can be added or removed, an establishment can move, and a service can evolve. Check the affected pages when these changes occur; remove or update information that has become false. To examine the consistency between pages, the listing, and service areas, use the ",
          {
            label: "local SEO audit",
            href: "/ressources/audit-seo-local",
          },
          " method.",
        ],
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
          label: "Finding the right local keywords",
          href: "/ressources/mots-cles-seo-local",
        },
        {
          label: "Local SEO Audit: Examining your entire presence",
          href: "/ressources/audit-seo-local",
        },
      ],
    },
    {
      heading: "Discover Flowpoint's local SEO page",
      paragraphs: [
        [
          "To view Flowpoint's presentation on local SEO, visit the ",
          {
            label: "Local SEO",
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
            "Spam policies for Google web search, including doorway pages — Google Search Central",
          href: "https://developers.google.com/search/docs/essentials/spam-policies?hl=en#doorways",
        },
        {
          label:
            "Guidelines for representing your business — Google Business Profile Help",
          href: "https://support.google.com/business/answer/3038177?hl=en",
        },
        {
          label:
            "Business eligibility — Google Business Profile Help",
          href: "https://support.google.com/business/answer/13763036?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [],
};
