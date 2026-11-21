import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_CHECKLIST: ResourceArticle = {
  slug: "checklist-audit-seo-technique",
  title: "Technical SEO Audit Checklist: Essential Checks | FlowPoint",
  metaDescription:
    "Use this technical SEO audit checklist to check crawling, indexing, URLs, JavaScript rendering and performance, then prioritize practical fixes for your site.",
  h1: "Technical SEO Audit Checklist: What to Check and How to Act",
  cluster: "SEO Audit",
  parentLanding: "/seo-audit",
  parentLandingCta: {
    heading: "To go further",
    description:
      "For an overview of the features and checks presented by Flowpoint, consult the SEO Audit page.",
    label: "Consult the SEO Audit page",
  },
  datePublished: "2026-10-07",
  dateModified: "2026-10-07",
  author: "Flowpoint Team",
  published: true,
  content: [
    {
      paragraphs: [
        "The general SEO audit guide helps frame an audit and build an action plan. This checklist focuses on technical URL and template checks: what to inspect, what evidence to keep, and what action to confirm.",
        "An isolated signal is not enough to establish an anomaly: a 404 may be intentional, and a lab test does not represent all visits. Verify the expected state and context before fixing.",
      ],
      links: [
        {
          label: "General guide: how to perform an SEO audit of your website?",
          href: "/ressources/comment-faire-audit-seo-site-web",
        },
      ],
    },
    {
      heading: "How to use this checklist",
      paragraphs: [
        "Choose a few strategic URLs and a representative page for each relevant template. For each check, record:",
      ],
      bullets: [
        "the URL or template and the expected state;",
        "the date, device, method, and source;",
        "the observed evidence (HTTP response, header, rendering, crawl, or field data);",
        "the planned action and the result to check after correction.",
      ],
    },
    {
      paragraphs: [
        "Prioritize according to the observed effect, not according to an automated score or just the number of URLs:",
      ],
      bullets: [
        "Possible blocking of crawling or indexing: access denied by mistake, unexpected noindex, server error response, or essential content missing after rendering. First confirm that the page should be accessible and indexable.",
        "Significant problem, without established blocking: broken internal links, inconsistent redirection or canonical, or degraded mobile usage. Check the URLs and the relevant journey before intervening.",
        "Optimization to measure: performance, structured data, or presentation in results, if the access and usage of the page remain correct. The priority depends on the page and the observed effect.",
      ],
    },
    {
      paragraphs: [
        "These categories guide the check; they do not replace the verification of the expected state for each URL.",
      ],
    },
    {
      heading: "1. Verify access and crawling",
    },
    {
      heading: "Does robots.txt allow access to important pages?",
      headingLevel: 3,
      paragraphs: [
        "To check: the robots.txt file of the correct domain, the rules corresponding to the targeted robots, and the important URLs to which these rules apply.",
        "Why: robots.txt is mainly used to manage crawling. It does not guarantee that a blocked URL will remain absent from the results: Google can know a URL through links even without crawling its content. To request that a page not be indexed, use an appropriate directive rather than a robots.txt rule alone.",
        "How to verify: open https://votre-domaine/robots.txt, then compare the rules against the URLs in scope. For an important URL, use the URL inspection in Search Console to check if crawling is authorized and what Google can load.",
        "Symptom to examine: a Disallow rule that covers a page that should be crawled, or a resource necessary for rendering the page.",
        "Action: have the rule confirmed by the person responsible for the site; do not remove a directive before establishing the expected state for the affected URLs.",
      ],
      links: [
        {
          label: "Introduction to robots.txt — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=en",
        },
        {
          label: "Block indexing — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=en",
        },
      ],
    },
    {
      heading: "What do URLs and their redirects return?",
      headingLevel: 3,
      paragraphs: [
        "To check: the HTTP response of each important URL, the final target of redirects, server errors, and the content actually returned.",
        "Why: Google handles success responses, redirects, client errors, and server errors differently. An error page displayed with a 200 status can also be interpreted as a soft 404.",
        "How to verify: in the browser or with a crawl tool, follow a URL to its final destination and note each code and Location header. If you use curl, verify that the GET response matches what a visitor sees; some servers do not handle HEAD and GET the same way.",
        "Symptom to examine: redirect loop or chain, unexpected destination, 5xx response, internal link to a 404 page, or error page returning 200.",
        "Action: fix links pointing to the wrong URL; confirm the intended destination before modifying a redirect. A 404 should not be fixed automatically if the deletion is intentional and no important journey depends on this URL.",
      ],
      links: [
        {
          label: "HTTP status codes and crawling — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors?hl=en",
        },
      ],
    },
    {
      heading: "Are important pages discovered via links?",
      headingLevel: 3,
      paragraphs: [
        "To check: internal links to pages in scope, broken links, and pages that receive no relevant links.",
        "Why: the sitemap does not replace consistent navigation. HTML links containing an href are a clear way to make URLs crawlable.",
        "How to verify: launch a crawl of the site or a representative scope, then compare important pages against the list of URLs reached by links. Also verify that navigation links work with a keyboard and on mobile.",
        "Symptom to examine: important page without internal link, links to old URLs, or URL available only after an interaction that the robot cannot follow like an ordinary link.",
        "Action: add or fix a link from a relevant page. There is no universal number of clicks that automatically makes a page good or bad: the priority depends on its role and how easily a visitor can find it.",
      ],
      links: [
        {
          label: "Crawlable links — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable?hl=en",
        },
      ],
    },
    {
      heading: "2. Verify indexing and preferred URLs",
    },
    {
      heading: "Does a noindex directive exclude a page by mistake?",
      headingLevel: 3,
      paragraphs: [
        "To check: meta robots or Googlebot tags on the page, as well as the HTTP X-Robots-Tag header.",
        "Why: a noindex directive tells Google not to include the page in its results when it can read this directive. If robots.txt prevents it from accessing the page, it may not see the noindex.",
        "How to verify: inspect HTTP headers and HTML delivered by the server, then the rendered DOM if the site adds tags via JavaScript. Compare with the expected state for the page; URL inspection can complete this check.",
        "Symptom to examine: a page supposed to be indexable has noindex, or the initial HTML and the rendered version give different directives.",
        "Action: remove noindex only if the page should actually be indexable. Verify that the directive is removed from all relevant layers and that Google can access the page to see it. This does not guarantee its indexing.",
      ],
      links: [
        {
          label: "Block indexing with noindex — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=en",
        },
      ],
    },
    {
      heading: "Does the sitemap contain the URLs the site wants to be discovered?",
      headingLevel: 3,
      paragraphs: [
        "To check: that sitemap URLs correspond to important, accessible pages planned for indexing, and that they use the preferred versions.",
        "Why: a sitemap helps engines discover URLs, especially when the linking structure is not enough to make them spotted. Its presence guarantees neither crawling nor indexing.",
        "How to verify: compare some sitemap entries with their HTTP status, canonical, and indexing directives. Look specifically for redirected, non-indexable, errored, or duplicate URLs.",
        "Symptom to examine: the sitemap lists an old URL, an HTTP version, a redirected URL, or a page that has noindex.",
        "Action: keep in the sitemap the preferred URLs that the site wants to be discovered; fix inconsistencies at their source and check internal links pointing to the old version. Do not consider submitting a sitemap as a guaranteed indexing request.",
      ],
      links: [
        {
          label: "Sitemaps — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=en",
        },
      ],
    },
    {
      heading: "Do canonicals, redirects, and links designate the same version?",
      headingLevel: 3,
      paragraphs: [
        "To check: duplicates created by HTTP/HTTPS variants, www/non-www, trailing slash, parameters, or close versions of the same page; then rel=canonical tags.",
        "Why: canonicals are a preference signal among several signals used to choose a representative URL. Google may choose another URL. Documentation recommends keeping canonicals, redirects, internal links, and sitemaps consistent.",
        "How to verify: on a page that has possible duplicates, compare the content, declared canonical, redirection target, internal links, and the URL registered in the sitemap. Use URL inspection to view the canonical URL selected by Google when this data is available.",
        "Symptom to examine: the canonical targets another page without clear reason, or redirects, the sitemap, and internal links point to different versions.",
        "Action: first define the URL the site wants to keep. Align signals around this decision, then recheck variants. Do not turn an apparent duplicate into a redirect or a noindex without checking if the pages have distinct uses.",
      ],
      links: [
        {
          label: "Consolidation of duplicate URLs — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=en",
        },
      ],
    },
    {
      heading: "3. Verify architecture, mobile, and JavaScript",
    },
    {
      heading: "Is essential content present after rendering?",
      headingLevel: 3,
      paragraphs: [
        "To check: main content, links, canonical, and robots directives on the rendered page, especially if the site depends on JavaScript.",
        "Why: Google can process JavaScript, but its crawling and rendering are not identical to a simple consultation in a browser. Content available after execution should not be assumed visible without verification.",
        "How to verify: compare the HTML received before JavaScript with the DOM rendered in the browser. Then verify the preview of the crawled page in URL inspection, blocked resources, and reported JavaScript errors.",
        "Symptom to examine: content or links appear only after an interaction, a necessary resource is blocked, or a non-existent page displays an error page with status 200.",
        "Action: make links and essential information accessible reliably; verify HTTP codes for valid and non-existent routes. Fix the rendering cause before adding SEO directives.",
      ],
      links: [
        {
          label: "JavaScript SEO basics — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=en",
        },
      ],
    },
    {
      heading: "Does the mobile version retain useful information?",
      headingLevel: 3,
      paragraphs: [
        "To check: main content, links, robots directives, and structured data on mobile, as well as the actual usage of the page at small width.",
        "Why: Google uses the mobile version for indexing and ranking. Google's mobile-first recommendations insist on the consistency of content and important data between versions.",
        "How to verify: test important templates on a phone or in a browser at mobile width; check the content that appears, links, menus, forms, and the presence of essential information in the inspected rendering.",
        "Symptom to examine: important content or links are missing on mobile, a resource is blocked, or the page cannot be used without excessive zooming or horizontal scrolling.",
        "Action: fix the relevant template then re-check the rendering and navigation paths. Avoid confusing an observed usability flaw with an automatic conclusion about ranking.",
      ],
      links: [
        {
          label: "Mobile-first indexing best practices — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing?hl=en",
        },
      ],
    },
    {
      heading: "4. Check HTTPS and performance",
    },
    {
      heading: "Do site variants lead to a consistent HTTPS version?",
      headingLevel: 3,
      paragraphs: [
        "To check: TLS certificate, HTTP/HTTPS and www/non-www versions, redirects, and page resources loaded over HTTP.",
        "Why: multiple accessible variants can create URL inconsistencies and navigation or security issues. HTTPS canonicalization is one of the selection signals for a canonical URL.",
        "How to verify: open known variants, note each response and final destination, then inspect resources flagged as mixed content by the browser. Verify the certificate in the connection details.",
        "Symptom to examine: expired or untrusted certificate, inconsistent redirection, important page accessible only over HTTP, or HTTPS resource blocked by HTTP loading.",
        "Action: request a fix from the person responsible for hosting or the template; then align links, canonicals, and sitemap URLs on the expected version.",
      ],
      links: [
        {
          label: "Signals for canonical URL selection — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=en",
        },
      ],
    },
    {
      heading: "Are Core Web Vitals measured with the right method?",
      headingLevel: 3,
      paragraphs: [
        "To check: LCP (loading), INP (responsiveness), and CLS (visual stability), as well as the affected pages and devices.",
        "Why: Core Web Vitals describe loading, responsiveness, and visual stability. For field data, the thresholds for a good experience are evaluated at the 75th percentile, separately for mobile and desktop: LCP ≤ 2.5s, INP ≤ 200ms, and CLS ≤ 0.1. A lab test helps search for a cause but does not replace field data.",
        "How to verify: consult field data when available, segmented by device and URL group; complete them with a lab test to look for a reproducible cause. Note the tool, device, and tested page.",
        "Symptom to examine: field and lab data seem contradictory, or a single score is treated as proof that all pages are slow.",
        "Action: identify the model and device affected, reproduce the problem, then look for a verifiable technical cause. Improving Core Web Vitals can improve experience, but does not guarantee a particular position in results.",
      ],
      links: [
        {
          label: "Core Web Vitals — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=en",
        },
        {
          label: "Web Vitals thresholds — web.dev",
          href: "https://web.dev/articles/vitals?hl=en",
        },
      ],
    },
    {
      heading: "5. Verify structured data and page tags",
    },
    {
      heading: "Do structured data describe visible content?",
      headingLevel: 3,
      paragraphs: [
        "To check: is the type of structured data appropriate for the page, is the JSON valid, do the properties correspond to visible content, and are Google guidelines respected?",
        "Why: structured data can make a page eligible for certain rich results when it meets applicable conditions; their presence does not guarantee that Google will display a rich result.",
        "How to verify: validate syntax and warnings with the appropriate tool, then compare each property to the visible page. Also inspect rendering errors when markup is generated by JavaScript.",
        "Symptom to examine: parsing error, tagged information absent from visible content, or type chosen with no relation to the page.",
        "Action: fix or remove non-compliant markup; do not create an FAQ just to try to get a rich result.",
      ],
      links: [
        {
          label: "Introduction to structured data — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data?hl=en",
        },
        {
          label: "Rich Results Test — Google",
          href: "https://search.google.com/test/rich-results",
        },
      ],
    },
    {
      heading: "Do the title and meta description correspond to the rendered page?",
      headingLevel: 3,
      paragraphs: [
        "To check: are the title and meta description elements present, accurate, and consistent with page content, including after JavaScript rendering?",
        "Why: Google can generate title links and snippets from multiple signals and may choose text different from the one declared.",
        "How to verify: inspect delivered HTML and rendered page; look for empty, duplicate, generic titles, or those associated with the wrong template. Verify queries and pages in the Search Console performance report if you have access.",
        "Symptom to examine: an identical title on several templates, a description inherited by mistake, or missing values after rendering.",
        "Action: fix the template or metadata only after confirming the problem on affected URLs. Avoid length thresholds presented as universal rules: Google may truncate or rewrite displayed elements.",
      ],
      links: [
        {
          label: "Title links — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/title-link?hl=en",
        },
        {
          label: "Snippets and meta descriptions — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/snippet?hl=en",
        },
        {
          label: "Performance report — Search Console Help",
          href: "https://support.google.com/webmasters/answer/7576553?hl=en",
        },
      ],
    },
    {
      heading: "Control table to fill out",
      table: {
        caption: "Operational control table for technical SEO audit.",
        description:
          "Priority depends on URLs and the observed effect; it does not constitute a universal score.",
        headers: [
          "Priority by context",
          "To check",
          "Why",
          "How to verify and what evidence to record",
          "Typical symptom",
          "Action to take",
        ],
        rows: [
          [
            "Treat first if the page is strategic",
            "robots.txt access",
            "Confirm that the robot can request the URL and useful resources",
            "Rules of the correct host, applicable group, URL inspection test",
            "Disallow rule covering an essential page or resource",
            "Have the rule confirmed then adjust its scope if it is unintentional",
          ],
          [
            "Treat first if the page is strategic",
            "HTTP status and redirects",
            "Verify that the URL and its destination can be consulted",
            "Code of each response, headers, final URL and delivered content",
            "Loop, unexpected destination, 5xx, internal 404, or error page as 200",
            "Fix the route or link according to the intended state; keep intentional 404s",
          ],
          [
            "Treat first if indexing is desired",
            "noindex and X-Robots-Tag",
            "Ensure that a directive does not contradict the desired state",
            "Headers, initial HTML, rendered DOM, URL inspection",
            "Page to index marked noindex",
            "Remove the directive only after validation of the intention",
          ],
          [
            "Fix if URLs do not match",
            "XML Sitemap",
            "Help discover preferred URLs",
            "Compare sitemap, status, canonical, and robots directive",
            "Redirected, errored, or non-indexable URL in the sitemap",
            "Replace the entry with the preferred URL or remove it if it is no longer to be discovered",
          ],
          [
            "Fix if signals diverge",
            "Canonical and variants",
            "Express a clear preference for similar or duplicate pages",
            "Compare canonical, redirect, internal links, sitemap, and variants",
            "Signals to several competing URLs",
            "Choose the target URL then align signals",
          ],
          [
            "According to the importance of the page",
            "Architecture and internal links",
            "Allow visitors and robots to find useful pages",
            "Crawl of href links, pages without incoming links, broken links",
            "Important page isolated or accessible only by interaction",
            "Add or fix a link from a relevant context",
          ],
          [
            "Fix if content does not appear",
            "JavaScript rendering",
            "Verify that content, links, and directives are visible after rendering",
            "Compare received HTML, rendered DOM, and inspected page",
            "Content absent, blocked resource, JS error, or non-existent route as 200",
            "Fix the rendering or HTTP status, then inspect again",
          ],
          [
            "Fix if essential content or path is degraded",
            "Mobile version",
            "Control content, links, directives, and usage at small width",
            "Test on phone or mobile browser, comparison of rendered content and links",
            "Important content or links absent, unusable menu, or excessive horizontal scrolling",
            "Fix the relevant template then re-check the rendering and navigation",
          ],
          [
            "Treat if secure access or variants are inconsistent",
            "HTTPS and variants",
            "Verify certificate, redirects, and resources loaded over HTTP",
            "Control HTTP/HTTPS and www/non-www versions, final destinations, and mixed content",
            "Expired certificate, inconsistent redirection, or HTTP resource on an HTTPS page",
            "Have the cause fixed then align links, canonicals, and sitemap on the expected version",
          ],
          [
            "Measure before optimizing",
            "Core Web Vitals",
            "Separate a field signal from a lab measurement",
            "Field data at 75th percentile by device and reproducible tests",
            "Isolated score is generalized to all pages",
            "Reproduce, identify relevant template, and measure after fix",
          ],
          [
            "According to page type",
            "Structured data",
            "Detect syntax or eligibility errors",
            "Validator or rich results test, comparison to visible content",
            "Error, non-compliant property, or unrelated markup",
            "Fix or remove; do not promise rich display",
          ],
          [
            "Fix if values are wrong",
            "Title and meta description",
            "Confirm that page information is consistent",
            "Delivered and rendered HTML, comparison between templates and Search Console if available",
            "Empty, generic, duplicate, or outdated values",
            "Fix at source and check affected URLs",
          ],
        ],
      },
    },
    {
      heading: "Fictional example: an important page marked noindex",
      paragraphs: [
        "The fictional URL https://exemple.fr/guides/maintenance must remain accessible to visitors and can be indexed. It responds with 200, appears in the sitemap, and receives internal links. However, its HTML contains meta name=\"robots\" content=\"noindex\".",
        "1. Evidence: note the delivered HTML and confirm the directive in the rendered DOM.",
        "2. Context: verify with the team if this page should actually be indexable; a directive may be desired on certain pages.",
        "3. Action: if it is unintentional, remove noindex from the template or the affected URL without blocking robot access in robots.txt.",
        "4. Control: after deploying the fix, check the response, rendered directives, and URL inspection again.",
        "This example is entirely fictional; it describes neither the Flowpoint site nor an observed result for a client. Removing a noindex does not guarantee indexing on its own.",
      ],
    },
    {
      heading: "After the check",
      paragraphs: [
        [
          "After a fix, rerun the same check under comparable conditions and keep the before/after evidence. If field data or Search Console data is missing, note this limitation rather than inferring a result from an isolated lab test. For more context, see ",
          {
            label: "interpret and prioritize technical SEO audit findings",
            href: "/resources/interpret-seo-audit-results",
          },
          ".",
        ],
      ],
    },
    {
      heading: "Official sources",
      paragraphs: [
        "These sources document the checks and limitations described in the checklist.",
      ],
      links: [
        {
          label: "Google Search Central: robots.txt",
          href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=en",
        },
        {
          label: "Google Search Central: block indexing with noindex",
          href: "https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=en",
        },
        {
          label: "Google Search Central: sitemaps",
          href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=en",
        },
        {
          label: "Google Search Central: canonical URLs",
          href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=en",
        },
        {
          label: "Google Search Central: HTTP codes and crawling",
          href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors?hl=en",
        },
        {
          label: "Google Search Central: crawlable links",
          href: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable?hl=en",
        },
        {
          label: "Google Search Central: JavaScript SEO basics",
          href: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=en",
        },
        {
          label: "Google Search Central: mobile indexing",
          href: "https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing?hl=en",
        },
        {
          label: "Google Search Central: Core Web Vitals",
          href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=en",
        },
        {
          label: "web.dev: Core Web Vitals thresholds",
          href: "https://web.dev/articles/vitals?hl=en",
        },
        {
          label: "Google Search Central: structured data",
          href: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data?hl=en",
        },
        {
          label: "Google: Rich Results Test",
          href: "https://search.google.com/test/rich-results",
        },
        {
          label: "Google Search Central: title links",
          href: "https://developers.google.com/search/docs/appearance/title-link?hl=en",
        },
        {
          label: "Google Search Central: snippets and meta descriptions",
          href: "https://developers.google.com/search/docs/appearance/snippet?hl=en",
        },
        {
          label: "Search Console: URL inspection",
          href: "https://support.google.com/webmasters/answer/9012289?hl=en",
        },
        {
          label: "Search Console: performance report",
          href: "https://support.google.com/webmasters/answer/7576553?hl=en",
        },
      ],
    },
  ],
  relatedArticles: [],
};
