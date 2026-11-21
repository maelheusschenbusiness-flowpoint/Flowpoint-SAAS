import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { parse } from "parse5";
import {
  PUBLIC_AUDIT_CATEGORIES,
  type PublicAuditCategory,
  type PublicAuditCategoryKey,
  type PublicAuditCheck,
  type PublicAuditDifficulty,
  type PublicAuditReport,
  type PublicAuditSeverity,
  type PublicAuditStatus,
  type PublicAuditQuota,
} from "@shared/public-audit";
import {
  PublicAuditTargetError,
  safePublicFetch,
  type PublicFetchOptions,
  type PublicFetchResult,
} from "./public-audit-fetch";

const MAX_CSS_FILES = 3;
const MAX_ASSETS = 4;
const MAX_INTERNAL_LINKS = 3;
const MAX_AUXILIARY_CONCURRENCY = 2;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 64 * 1024;
export const PUBLIC_AUDIT_STANDARD_SIGNUP_URL =
  "https://app.flowpoint.pro/signin.html?plan=standard";

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

type AuditInput = {
  requestedUrl: string;
  page: PublicFetchResult;
  robots: PublicFetchResult | null;
  sitemap: PublicFetchResult | null;
  css: Array<{ url: string; response: PublicFetchResult | null }>;
  assets: Array<{ url: string; response: PublicFetchResult | null }>;
  internalLinks: Array<{ url: string; response: PublicFetchResult | null }>;
  quota: PublicAuditQuota;
};

function header(
  headers: PublicFetchResult["headers"],
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
}

function elementName(node: HtmlNode): string {
  return (node.tagName ?? "").toLowerCase();
}

function collectElements(root: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (node: HtmlNode) => {
    if (node.tagName) result.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return result;
}

function getAttribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name)
    ?.value;
}

function visibleText(node: HtmlNode): string {
  const tag = elementName(node);
  if (["script", "style", "template", "noscript", "svg"].includes(tag)) {
    return "";
  }
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(visibleText).join(" ");
}

function rawText(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(rawText).join("");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decompressText(
  response: PublicFetchResult,
  maximumOutputBytes: number,
): string | null {
  const encoding = header(response.headers, "content-encoding")?.toLowerCase();
  if (!encoding || encoding === "identity") return response.body.toString("utf8");
  try {
    const options = { maxOutputLength: maximumOutputBytes };
    if (encoding.includes("gzip")) return gunzipSync(response.body, options).toString("utf8");
    if (encoding.includes("deflate")) return inflateSync(response.body, options).toString("utf8");
    if (encoding.includes("br")) return brotliDecompressSync(response.body, options).toString("utf8");
  } catch {
    return null;
  }
  return null;
}

function priorityFor(status: PublicAuditStatus, severity: PublicAuditSeverity): number {
  if (status === "passed" || status === "not_measured" || severity === "info") {
    return 99;
  }
  const base: Record<PublicAuditSeverity, number> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
    info: 99,
  };
  return Math.min(5, base[severity] + (status === "warning" ? 1 : 0));
}

function makeCheck(
  id: string,
  title: string,
  status: PublicAuditStatus,
  severity: PublicAuditSeverity,
  evidence: string | null,
  explanation: string,
  impact: string,
  recommendation: string,
  difficulty: PublicAuditDifficulty = "easy",
): PublicAuditCheck {
  return {
    id,
    title,
    status,
    severity,
    evidence,
    explanation,
    impact,
    recommendation,
    priority: priorityFor(status, severity),
    difficulty,
  };
}

function notMeasured(
  id: string,
  title: string,
  reason: string,
): PublicAuditCheck {
  return makeCheck(
    id,
    title,
    "not_measured",
    "info",
    null,
    reason,
    "This check needs browser-based field or runtime data that this public audit does not collect.",
    "Use real-user monitoring or a browser test to measure this area.",
    null,
  );
}

export function scorePublicAuditCategory(
  key: PublicAuditCategoryKey,
  checks: PublicAuditCheck[],
): PublicAuditCategory {
  const measured = checks.filter((check) =>
    ["passed", "failed", "warning"].includes(check.status),
  );
  const weighted = measured.filter((check) => check.severity !== "info");
  const weights: Record<PublicAuditSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  };
  const denominator = weighted.reduce(
    (sum, check) => sum + weights[check.severity],
    0,
  );
  const score =
    weighted.length >= 3 && denominator > 0
      ? Math.round(
          (weighted.reduce((sum, check) => {
            const value =
              check.status === "passed"
                ? 1
                : check.status === "warning"
                  ? 0.5
                  : 0;
            return sum + value * weights[check.severity];
          }, 0) /
            denominator) *
            100,
        )
      : null;
  const failed = measured.filter((check) => check.status === "failed").length;
  const warnings = measured.filter((check) => check.status === "warning").length;
  const passed = measured.filter((check) => check.status === "passed").length;
  const unmeasured = checks.length - measured.length;
  const title = PUBLIC_AUDIT_CATEGORIES.find((item) => item.key === key)!.title;

  return {
    key,
    title,
    score,
    status:
      measured.length === 0
        ? "not_measured"
        : unmeasured === 0 && measured.length >= 4
          ? "measured"
          : "partial",
    summary:
      measured.length === 0
        ? "No reliable results were available for this area."
        : `${passed} passed${failed ? `, ${failed} need attention` : ""}${warnings ? `, ${warnings} need review` : ""}${unmeasured ? `; ${unmeasured} not measured` : ""}.`,
    checks,
  };
}

async function runLimited<T, R>(
  values: T[],
  maximum: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(maximum, values.length) },
    async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await callback(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function sameOriginUrl(raw: string, base: URL): string | null {
  try {
    const url = new URL(raw, base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== base.origin
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function responseContentType(response: PublicFetchResult | null): string {
  return header(response?.headers ?? {}, "content-type")?.toLowerCase() ?? "";
}

function classifyThreshold(
  value: number,
  good: number,
  warn: number,
): PublicAuditStatus {
  return value <= good ? "passed" : value <= warn ? "warning" : "failed";
}

function scanRobotsDisallow(body: Buffer): boolean | null {
  const text = body.toString("utf8").slice(0, 64 * 1024);
  const userAgentBlocks = text
    .split(/^\s*user-agent\s*:/im)
    .slice(1)
    .map((section) => section.split(/^\s*user-agent\s*:/im)[0]);
  if (!userAgentBlocks.length) return null;
  return userAgentBlocks.some((section) =>
    /^\s*disallow\s*:\s*\/\s*(?:#.*)?$/im.test(section),
  );
}

async function getPageSupportingData(
  pageUrl: string,
  root: HtmlNode,
  signal?: AbortSignal,
  fetcher: (
    input: string,
    options?: PublicFetchOptions,
  ) => Promise<PublicFetchResult> = safePublicFetch,
) {
  const base = new URL(pageUrl);
  const elements = collectElements(root);
  const cssUrls = Array.from(
    new Set(
      elements
        .filter(
          (element) =>
            elementName(element) === "link" &&
            (getAttribute(element, "rel") ?? "")
              .toLowerCase()
              .split(/\s+/)
              .includes("stylesheet"),
        )
        .map((element) =>
          sameOriginUrl(getAttribute(element, "href") ?? "", base),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, MAX_CSS_FILES);

  const assetUrls = Array.from(
    new Set(
      elements
        .filter((element) =>
          ["img", "script", "iframe"].includes(elementName(element)),
        )
        .map((element) =>
          sameOriginUrl(
            getAttribute(element, "src") ?? "",
            base,
          ),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, MAX_ASSETS);

  const linkUrls = Array.from(
    new Set(
      elements
        .filter((element) => elementName(element) === "a")
        .map((element) =>
          sameOriginUrl(getAttribute(element, "href") ?? "", base),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, MAX_INTERNAL_LINKS);

  const fetchCss = async (url: string) => {
    try {
      const response = await fetcher(url, {
        maxBytes: MAX_CSS_BYTES,
        maxRedirects: 1,
        expectedOrigin: base.origin,
        signal,
      });
      return { url, response };
    } catch {
      return { url, response: null };
    }
  };
  const fetchHead = async (url: string) => {
    try {
      const response = await fetcher(url, {
        method: "HEAD",
        maxRedirects: 1,
        expectedOrigin: base.origin,
        signal,
      });
      return { url, response };
    } catch {
      return { url, response: null };
    }
  };

  const robotsUrl = new URL("/robots.txt", base.origin).toString();
  const defaultSitemapUrl = new URL("/sitemap.xml", base.origin).toString();
  const [robots, css, assets, internalLinks] = await Promise.all([
    fetcher(robotsUrl, {
      maxBytes: 64 * 1024,
      maxRedirects: 1,
      expectedOrigin: base.origin,
      signal,
    }).catch(() => null),
    runLimited(cssUrls, MAX_AUXILIARY_CONCURRENCY, fetchCss),
    runLimited(assetUrls, MAX_AUXILIARY_CONCURRENCY, fetchHead),
    runLimited(linkUrls, MAX_AUXILIARY_CONCURRENCY, fetchHead),
  ]);

  let sitemapUrl = defaultSitemapUrl;
  if (robots) {
    const sitemapDirective = robots.body
      .toString("utf8")
      .slice(0, 64 * 1024)
      .match(/^\s*sitemap\s*:\s*(\S+)/im)?.[1];
    if (sitemapDirective) {
      sitemapUrl =
        sameOriginUrl(sitemapDirective, base) ?? defaultSitemapUrl;
    }
  }
  const sitemap = await fetcher(sitemapUrl, {
    maxBytes: 64 * 1024,
    maxRedirects: 1,
    expectedOrigin: base.origin,
    signal,
  }).catch(() => null);

  return { robots, sitemap, css, assets, internalLinks, elements };
}

export async function createPublicAuditReport(
  inputUrl: string,
  quota: PublicAuditQuota,
  signal?: AbortSignal,
  fetcher: (
    input: string,
    options?: PublicFetchOptions,
  ) => Promise<PublicFetchResult> = safePublicFetch,
): Promise<PublicAuditReport> {
  let page: PublicFetchResult;
  try {
    page = await fetcher(inputUrl, {
      maxBytes: MAX_HTML_BYTES,
      signal,
    });
  } catch (error) {
    if (error instanceof PublicAuditTargetError) throw error;
    throw new PublicAuditTargetError("connection_failed");
  }

  const contentType = header(page.headers, "content-type")?.toLowerCase() ?? "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new PublicAuditTargetError("invalid_url");
  }

  const html = decompressText(page, 1024 * 1024);
  if (html === null) {
    throw new PublicAuditTargetError("connection_failed");
  }
  const document = parse(html) as unknown as HtmlNode;
  const elements = collectElements(document);
  const byTag = (tag: string) =>
    elements.filter((element) => elementName(element) === tag);
  const first = (tag: string) => byTag(tag)[0];
  const title = normalizeText(visibleText(first("title") ?? { nodeName: "" }));
  const metaDescription =
    elements.find(
      (element) =>
        elementName(element) === "meta" &&
        getAttribute(element, "name")?.toLowerCase() === "description",
    ) ?? null;
  const description =
    getAttribute(metaDescription ?? { nodeName: "" }, "content")?.trim() ?? "";
  const canonical = elements.find(
    (element) =>
      elementName(element) === "link" &&
      (getAttribute(element, "rel") ?? "").toLowerCase() === "canonical",
  );
  const viewport = elements.find(
    (element) =>
      elementName(element) === "meta" &&
      getAttribute(element, "name")?.toLowerCase() === "viewport",
  );
  const robotsMeta = elements.find(
    (element) =>
      elementName(element) === "meta" &&
      getAttribute(element, "name")?.toLowerCase() === "robots",
  );
  const headings = elements.filter((element) =>
    /^h[1-6]$/.test(elementName(element)),
  );
  const h1s = headings.filter((element) => elementName(element) === "h1");
  const pageUrl = new URL(page.finalUrl);
  const base = `${pageUrl.origin}${pageUrl.pathname}`;
  const pageText = normalizeText(visibleText(document));
  const words =
    pageText.match(/[A-Za-z0-9\u00C0-\u024F]+(?:['’][A-Za-z\u00C0-\u024F]+)?/g) ??
    [];
  const paragraphs = byTag("p")
    .map((element) => normalizeText(visibleText(element)))
    .filter((value) => value.length > 30);
  const uniqueParagraphs = new Set(paragraphs.map((value) => value.toLowerCase()));
  const controls = elements.filter((element) =>
    ["input", "select", "textarea"].includes(elementName(element)),
  );
  const forms = byTag("form");
  const labelFor = new Set(
    byTag("label")
      .map((label) => getAttribute(label, "for"))
      .filter((value): value is string => Boolean(value)),
  );
  const formControlsNamed = controls.filter((control) => {
    const id = getAttribute(control, "id");
    const hasLabel = id ? labelFor.has(id) : false;
    const hasAria =
      Boolean(getAttribute(control, "aria-label")) ||
      Boolean(getAttribute(control, "aria-labelledby"));
    const isHidden = getAttribute(control, "type")?.toLowerCase() === "hidden";
    return isHidden || hasLabel || hasAria;
  });
  const namedLinksAndButtons = elements.filter((element) => {
    if (!["a", "button"].includes(elementName(element))) return false;
    const text = normalizeText(visibleText(element));
    return Boolean(
      text ||
        getAttribute(element, "aria-label") ||
        getAttribute(element, "aria-labelledby"),
    );
  });
  const allLinksAndButtons = elements.filter((element) =>
    ["a", "button"].includes(elementName(element)),
  );
  const images = byTag("img");
  const imagesWithAlt = images.filter(
    (image) => getAttribute(image, "alt") !== undefined,
  );
  const imageSrcsets = images.filter((image) =>
    Boolean(getAttribute(image, "srcset")),
  );
  const headingText = headings
    .map((element) => normalizeText(visibleText(element)).toLowerCase())
    .filter(Boolean);
  const duplicateHeadingCount =
    headingText.length - new Set(headingText).size;
  const ids = new Set(
    elements
      .map((element) => getAttribute(element, "id"))
      .filter((value): value is string => Boolean(value)),
  );
  const internalAnchors = elements
    .filter((element) => elementName(element) === "a")
    .map((element) => getAttribute(element, "href") ?? "")
    .filter((value) => value.startsWith("#") && value.length > 1);
  const unresolvedAnchors = internalAnchors.filter(
    (anchor) => !ids.has(decodeURIComponent(anchor.slice(1))),
  ).length;
  const pageStyles = [
    ...byTag("style").map(rawText),
    ...elements
      .map((element) => getAttribute(element, "style") ?? "")
      .filter(Boolean),
  ];
  const pageCssInline = pageStyles.join("\n");
  const mobileZoomAllowed =
    !/maximum-scale\s*=\s*1(?:\.0+)?/i.test(
      getAttribute(viewport ?? { nodeName: "" }, "content") ?? "",
    ) &&
    !/user-scalable\s*=\s*no/i.test(
      getAttribute(viewport ?? { nodeName: "" }, "content") ?? "",
    );

  const support = await getPageSupportingData(
    page.finalUrl,
    document,
    signal,
    fetcher,
  );
  const externalCssContents = support.css
    .filter(
      (entry) =>
        entry.response &&
        responseContentType(entry.response).includes("text/css"),
    )
    .map((entry) => decompressText(entry.response!, 512 * 1024) ?? "");
  const allCss = `${pageCssInline}\n${externalCssContents.join("\n")}`;
  const resourceCount = byTag("img").length + byTag("script").length + byTag("link").length;
  const resourceBytes = support.assets.reduce(
    (sum, item) =>
      sum + Number(header(item.response?.headers ?? {}, "content-length") ?? 0),
    0,
  );
  const sameOriginAssets =
    support.assets.filter((item) => item.response).length;
  const robotsDisallow = support.robots
    ? scanRobotsDisallow(support.robots.body)
    : null;
  const robotsHeader = header(page.headers, "x-robots-tag") ?? "";
  const metaRobots = getAttribute(
    robotsMeta ?? { nodeName: "" },
    "content",
  ) ?? "";
  const noIndex = /\bnoindex\b/i.test(`${metaRobots} ${robotsHeader}`);
  const canonicalUrl = canonical
    ? sameOriginUrl(getAttribute(canonical, "href") ?? "", pageUrl)
    : null;
  const lang =
    getAttribute(first("html") ?? { nodeName: "" }, "lang")?.trim() ?? "";
  const hasJsonLd = byTag("script").filter(
    (element) =>
      getAttribute(element, "type")?.toLowerCase() === "application/ld+json",
  );
  const validJsonLd = hasJsonLd.filter((element) => {
    try {
      JSON.parse(rawText(element));
      return true;
    } catch {
      return false;
    }
  });
  const pageIsHttps = pageUrl.protocol === "https:";
  const responseHeaders = page.headers;
  const csp = header(responseHeaders, "content-security-policy");
  const frameOptions = header(responseHeaders, "x-frame-options");
  const hsts = header(responseHeaders, "strict-transport-security");
  const noSniff = header(responseHeaders, "x-content-type-options");
  const referrerPolicy = header(responseHeaders, "referrer-policy");
  const formActions = forms.map(
    (form) => getAttribute(form, "action") ?? pageUrl.toString(),
  );
  const insecureFormActions = formActions.filter((action) => {
    try {
      return new URL(action, pageUrl).protocol !== "https:";
    } catch {
      return true;
    }
  }).length;
  const mixedContentCount = elements
    .filter((element) =>
      ["img", "script", "iframe", "source"].includes(elementName(element)),
    )
    .map((element) => getAttribute(element, "src") ?? "")
    .concat(
      elements
        .filter(
          (element) =>
            elementName(element) === "link" &&
            (getAttribute(element, "rel") ?? "")
              .toLowerCase()
              .split(/\s+/)
              .includes("stylesheet"),
        )
        .map((element) => getAttribute(element, "href") ?? ""),
    )
    .filter((raw) => /^http:\/\//i.test(raw)).length;
  const cssHasMediaQuery = /@media\b/i.test(allCss);
  const cssResourcesMeasured = support.css.filter((item) => item.response).length;
  const titleLength = title.length;
  const descriptionLength = description.length;
  const internalLinkFailures = support.internalLinks.filter(
    (item) => item.response && item.response.status >= 400,
  );
  const unsupportedLinkMethods = support.internalLinks.filter(
    (item) => item.response && [405, 501].includes(item.response.status),
  );
  const internalLinkMeasured = support.internalLinks.length - unsupportedLinkMethods.length;
  const anchorStatus = unresolvedAnchors === 0 ? "passed" : "warning";

  const resultByKey: Record<PublicAuditCategoryKey, PublicAuditCheck[]> = {
    seo: [
      makeCheck(
        "seo-title",
        "Page title",
        title
          ? classifyThreshold(titleLength, 60, 70)
          : "failed",
        "high",
        title ? `${titleLength} characters: “${title.slice(0, 120)}”` : "No document title was found.",
        "The document title is read from the page's HTML head.",
        "Search listings and browser tabs use the title to describe this page.",
        title
          ? "Keep the title specific and concise, ideally around 30–60 characters."
          : "Add a unique, descriptive title element to the page head.",
      ),
      makeCheck(
        "seo-description",
        "Meta description",
        description
          ? classifyThreshold(descriptionLength, 160, 200)
          : "failed",
        "medium",
        description
          ? `${descriptionLength} characters`
          : "No meta description was found.",
        "The audit reads the description meta tag from the HTML response.",
        "A useful description can help people understand the page before opening it.",
        description
          ? "Write a clear summary and keep it concise."
          : "Add a page-specific meta description.",
      ),
      makeCheck(
        "seo-canonical",
        "Canonical URL",
        canonical
          ? canonicalUrl
            ? "passed"
            : "warning"
          : "warning",
        "medium",
        canonical
          ? canonicalUrl ?? "The canonical URL was absent or not same-origin."
          : "No canonical link was found.",
        "The audit checks whether a canonical URL is present and points to this public site.",
        "A clear canonical URL can reduce ambiguity between duplicate page URLs.",
        "Add or verify a self-referencing canonical URL for this page.",
      ),
      makeCheck(
        "seo-indexing",
        "Indexing directives",
        noIndex ? "failed" : "passed",
        "high",
        noIndex ? "A noindex directive was present." : "No noindex directive was found in the page meta tag or response header.",
        "The audit checks the HTML robots meta tag and X-Robots-Tag response header.",
        "A noindex directive can keep a page out of search results.",
        noIndex
          ? "Remove noindex if this page should appear in search results."
          : "Confirm this page's indexing intent matches your publishing plan.",
      ),
      makeCheck(
        "seo-heading",
        "Primary heading",
        h1s.length === 1 ? "passed" : h1s.length === 0 ? "failed" : "warning",
        "medium",
        `${h1s.length} H1 elements found.`,
        "The audit counts H1 elements in the returned HTML.",
        "A clear primary heading helps people and search systems understand the page topic.",
        "Use one descriptive H1 for the main page topic.",
      ),
      makeCheck(
        "seo-structured-data",
        "Structured data syntax",
        hasJsonLd.length === 0
          ? "not_measured"
          : validJsonLd.length === hasJsonLd.length
            ? "passed"
            : "warning",
        "low",
        hasJsonLd.length
          ? `${validJsonLd.length} of ${hasJsonLd.length} JSON-LD blocks parsed as JSON.`
          : null,
        "Only JSON syntax is checked; schema eligibility and search rich-result validation are not tested.",
        "Valid structured data can help eligible pages provide clearer context to search systems.",
        "Validate structured data with a dedicated schema and rich-result tester.",
        hasJsonLd.length ? "moderate" : null,
      ),
      makeCheck(
        "seo-robots",
        "Robots.txt response",
        support.robots
          ? support.robots.status < 400
            ? "passed"
            : "warning"
          : "not_measured",
        "low",
        support.robots
          ? `HTTP ${support.robots.status}`
          : "The robots.txt endpoint could not be measured.",
        "The audit requests only the site's robots.txt file.",
        "Robots.txt can communicate crawl preferences to compliant search crawlers.",
        "Check the file directly if you rely on crawler-specific rules.",
        support.robots ? "easy" : null,
      ),
      makeCheck(
        "seo-sitemap",
        "Sitemap response",
        support.sitemap
          ? support.sitemap.status < 400
            ? "passed"
            : "warning"
          : "not_measured",
        "low",
        support.sitemap
          ? `HTTP ${support.sitemap.status}${responseContentType(support.sitemap) ? ` · ${responseContentType(support.sitemap)}` : ""}`
          : "The sitemap endpoint could not be measured.",
        "The audit checks the sitemap URL advertised in robots.txt, or /sitemap.xml when none is advertised.",
        "A sitemap can help crawlers discover pages, but this check does not validate every listed URL.",
        "Verify the sitemap contains canonical, indexable URLs.",
        support.sitemap ? "easy" : null,
      ),
    ],
    performance: [
      makeCheck(
        "performance-ttfb",
        "Server response time",
        classifyThreshold(page.ttfbMs, 800, 1800),
        "high",
        `${page.ttfbMs} ms to response headers.`,
        "This is a single request from the audit server to the page's first response headers, not a user-experience or field metric.",
        "A slow first response can delay every resource that depends on the page.",
        "Check server rendering, caching, and upstream response time if this remains high.",
        "moderate",
      ),
      makeCheck(
        "performance-html-size",
        "HTML transfer size",
        classifyThreshold(page.transferBytes, 100 * 1024, 300 * 1024),
        "medium",
        `${Math.round(page.transferBytes / 1024)} KB received for the HTML response.`,
        "The measurement is for the HTML body only; assets and browser decoding are separate.",
        "Large HTML can take longer to transfer and parse on constrained connections.",
        "Remove unnecessary markup or move non-critical content out of the initial document.",
        "moderate",
      ),
      makeCheck(
        "performance-compression",
        "HTML response compression",
        header(page.headers, "content-encoding") &&
          header(page.headers, "content-encoding")?.toLowerCase() !== "identity"
          ? "passed"
          : page.transferBytes < 1024
            ? "not_measured"
            : "warning",
        "low",
        header(page.headers, "content-encoding") ??
          (page.transferBytes < 1024 ? "Response was too small to judge compression." : "No content-encoding response header was present."),
        "The audit checks the page response headers and does not estimate savings from compression.",
        "Compression can reduce transfer time for larger text responses.",
        "Enable gzip or Brotli for text responses when it is appropriate for your server.",
      ),
      makeCheck(
        "performance-resource-count",
        "Declared resource count",
        classifyThreshold(resourceCount, 25, 50),
        "low",
        `${resourceCount} image, script, and link elements were declared in the HTML.`,
        "This is a source-level count, not a browser network waterfall.",
        "Many resources can increase connection and processing work.",
        "Review the browser waterfall before combining or removing resources.",
      ),
      makeCheck(
        "performance-resource-sizes",
        "Same-site asset headers",
        support.assets.length === 0
          ? "not_measured"
          : sameOriginAssets === support.assets.length
            ? "passed"
            : "warning",
        "low",
        support.assets.length
          ? `${sameOriginAssets} of ${support.assets.length} sampled same-site assets returned HEAD responses; declared size was ${Math.round(resourceBytes / 1024)} KB.`
          : "No same-site image, script, or iframe resources were sampled.",
        "A small sample of same-origin assets was checked using HEAD requests only.",
        "Oversized or unavailable assets can affect real browser loads.",
        "Use a browser waterfall to measure full download sizes and loading behavior.",
        support.assets.length ? "moderate" : null,
      ),
      notMeasured(
        "performance-lcp",
        "Largest Contentful Paint",
        "No browser or real-user timing data is collected by this audit.",
      ),
      notMeasured(
        "performance-cls",
        "Cumulative Layout Shift",
        "Layout shifts can only be measured while a page is rendered in a browser.",
      ),
      notMeasured(
        "performance-inp",
        "Interaction to Next Paint",
        "This check needs real browser interactions or field data.",
      ),
    ],
    accessibility: [
      makeCheck(
        "accessibility-language",
        "Document language",
        lang ? "passed" : "warning",
        "medium",
        lang ? `lang="${lang}"` : "No lang attribute was found on the html element.",
        "The audit reads the language attribute from the returned HTML.",
        "Assistive technology uses language metadata to choose pronunciation rules.",
        "Set the correct language on the html element.",
      ),
      makeCheck(
        "accessibility-image-alt",
        "Image alternative text",
        images.length === 0
          ? "not_measured"
          : imagesWithAlt.length === images.length
            ? "passed"
            : "failed",
        "high",
        images.length
          ? `${imagesWithAlt.length} of ${images.length} images have an alt attribute.`
          : "No images were found in the returned HTML.",
        "This checks whether an alt attribute exists; it does not judge whether its wording is useful.",
        "Alternative text can make meaningful images available to people using screen readers.",
        "Add concise alt text to informative images and use empty alt text for decorative images.",
        images.length ? "moderate" : null,
      ),
      makeCheck(
        "accessibility-control-labels",
        "Form control names",
        controls.length === 0
          ? "not_measured"
          : formControlsNamed.length === controls.length
            ? "passed"
            : "failed",
        "high",
        controls.length
          ? `${formControlsNamed.length} of ${controls.length} controls have an associated label or accessible name.`
          : "No input, select, or textarea elements were found.",
        "The source check recognizes matching label-for, aria-label, aria-labelledby, and hidden controls.",
        "Named controls help screen-reader users understand what to enter.",
        "Give every user-facing form control a programmatic label.",
        controls.length ? "moderate" : null,
      ),
      makeCheck(
        "accessibility-link-names",
        "Link and button names",
        allLinksAndButtons.length === 0
          ? "not_measured"
          : namedLinksAndButtons.length === allLinksAndButtons.length
            ? "passed"
            : "warning",
        "medium",
        `${namedLinksAndButtons.length} of ${allLinksAndButtons.length} links and buttons have text or an ARIA name.`,
        "Names are inferred from text and ARIA attributes in the returned HTML.",
        "Clear control names describe actions to people using assistive technology.",
        "Add a concise accessible name to each unnamed link or button.",
        allLinksAndButtons.length ? "moderate" : null,
      ),
      makeCheck(
        "accessibility-heading-order",
        "Heading outline",
        headings.length === 0
          ? "warning"
          : h1s.length === 0
            ? "warning"
            : "passed",
        "low",
        `${h1s.length} H1 and ${headings.length} total heading elements found.`,
        "This source check counts headings but cannot inspect the rendered accessibility tree.",
        "A logical heading outline helps people navigate longer pages.",
        "Use headings in a meaningful hierarchy and avoid selecting levels only for visual size.",
      ),
      notMeasured(
        "accessibility-contrast",
        "Text color contrast",
        "Color contrast is not measured from CSS or rendered pixels in this audit.",
      ),
      notMeasured(
        "accessibility-keyboard",
        "Keyboard interaction",
        "Keyboard behavior requires browser interaction and is not tested here.",
      ),
    ],
    security: [
      makeCheck(
        "security-https",
        "HTTPS connection",
        pageIsHttps ? "passed" : "failed",
        "critical",
        pageUrl.protocol,
        "The page was requested using the final URL protocol after public redirects.",
        "HTTPS protects data in transit and helps visitors verify the site's identity.",
        pageIsHttps
          ? "Keep all public pages on HTTPS."
          : "Redirect the public site to HTTPS and update internal links.",
      ),
      makeCheck(
        "security-hsts",
        "HSTS response header",
        !pageIsHttps
          ? "not_measured"
          : hsts
            ? "passed"
            : "warning",
        "medium",
        hsts ?? (pageIsHttps ? "No Strict-Transport-Security header was found." : null),
        "The audit checks the final page response headers.",
        "HSTS tells compatible browsers to prefer secure connections for the site.",
        "Add HSTS after confirming the whole domain and its subdomains support HTTPS.",
        pageIsHttps ? "moderate" : null,
      ),
      makeCheck(
        "security-csp",
        "Content Security Policy",
        csp ? "passed" : "warning",
        "medium",
        csp ? csp.slice(0, 240) : "No Content-Security-Policy response header was found.",
        "This check only records whether a policy is present; it does not evaluate policy quality.",
        "A well-configured policy can reduce the impact of some script injection issues.",
        "Review a restrictive CSP that matches the site's required resources.",
        "hard",
      ),
      makeCheck(
        "security-nosniff",
        "MIME type protection",
        noSniff?.toLowerCase() === "nosniff" ? "passed" : "warning",
        "low",
        noSniff ?? "No X-Content-Type-Options header was found.",
        "The audit checks the response header value.",
        "The nosniff setting helps prevent browsers from guessing resource types.",
        "Set X-Content-Type-Options: nosniff.",
      ),
      makeCheck(
        "security-framing",
        "Frame protection",
        frameOptions || /frame-ancestors/i.test(csp ?? "")
          ? "passed"
          : "warning",
        "medium",
        frameOptions ??
          (/frame-ancestors/i.test(csp ?? "")
            ? "A CSP frame-ancestors directive was found."
            : "No X-Frame-Options or CSP frame-ancestors directive was found."),
        "This check looks for common clickjacking protections in response headers.",
        "Framing controls can prevent unwanted embedding of a page.",
        "Set an appropriate frame-ancestors policy or X-Frame-Options header.",
      ),
      makeCheck(
        "security-referrer",
        "Referrer policy",
        referrerPolicy ? "passed" : "warning",
        "low",
        referrerPolicy ?? "No Referrer-Policy response header was found.",
        "The audit records the page's response header.",
        "A deliberate policy can limit information sent in referrer headers.",
        "Set a Referrer-Policy that fits your analytics and privacy needs.",
      ),
      makeCheck(
        "security-mixed-content",
        "Insecure resource references",
        !pageIsHttps
          ? "not_measured"
          : mixedContentCount === 0
            ? "passed"
            : "failed",
        "high",
        pageIsHttps
          ? `${mixedContentCount} explicit HTTP asset or stylesheet references found.`
          : null,
        "This source check looks for absolute http:// resource and stylesheet references in the HTML.",
        "Insecure subresources can weaken an otherwise secure page.",
        "Use HTTPS URLs for scripts, stylesheets, images, and embeds.",
        pageIsHttps ? "moderate" : null,
      ),
      makeCheck(
        "security-form-actions",
        "Form destination security",
        forms.length === 0
          ? "not_measured"
          : insecureFormActions === 0
            ? "passed"
            : "failed",
        "high",
        forms.length
          ? `${insecureFormActions} of ${forms.length} form actions do not resolve to HTTPS.`
          : null,
        "The audit checks form action URLs in the HTML; it does not submit forms.",
        "Forms can carry information that should be sent over secure connections.",
        "Use HTTPS form actions and never submit credentials over HTTP.",
        forms.length ? "moderate" : null,
      ),
    ],
    mobile: [
      makeCheck(
        "mobile-viewport",
        "Viewport configuration",
        viewport
          ? mobileZoomAllowed
            ? "passed"
            : "warning"
          : "failed",
        "high",
        getAttribute(viewport ?? { nodeName: "" }, "content") ??
          "No viewport meta tag was found.",
        "The audit reads the viewport declaration from the returned HTML.",
        "A viewport meta tag helps browsers size pages for mobile screens.",
        viewport
          ? "Keep zoom available to visitors who need it."
          : "Add a responsive viewport meta tag.",
      ),
      makeCheck(
        "mobile-media-queries",
        "Responsive CSS declarations",
        cssResourcesMeasured === 0
          ? "not_measured"
          : cssHasMediaQuery
            ? "passed"
            : "warning",
        "medium",
        cssResourcesMeasured
          ? `${cssResourcesMeasured} stylesheet responses checked; ${cssHasMediaQuery ? "a media query was found." : "no @media rule was found in sampled CSS."}`
          : "No same-origin stylesheet content could be measured.",
        "The audit checks a small sample of same-origin CSS and inline styles; it does not render the page.",
        "Responsive rules can adapt layout to different screen sizes.",
        "Test the layout in real mobile and desktop browsers.",
        cssResourcesMeasured ? "moderate" : null,
      ),
      makeCheck(
        "mobile-srcset",
        "Responsive image sources",
        images.length === 0
          ? "not_measured"
          : imageSrcsets.length > 0
            ? "passed"
            : "warning",
        "low",
        images.length
          ? `${imageSrcsets.length} of ${images.length} images use srcset.`
          : "No images were found.",
        "This checks srcset presence only; it does not assess downloaded image dimensions.",
        "Responsive image sources can reduce unnecessary image downloads on smaller screens.",
        "Consider srcset and sizes for large or art-directed images.",
        images.length ? "moderate" : null,
      ),
      notMeasured(
        "mobile-overflow",
        "Horizontal overflow",
        "The page must be rendered at mobile widths to measure overflow.",
      ),
      notMeasured(
        "mobile-touch-targets",
        "Touch target size",
        "Rendered control dimensions are not measured in this source-only check.",
      ),
    ],
    conversion: [
      makeCheck(
        "conversion-actions",
        "Named page actions",
        allLinksAndButtons.length === 0
          ? "warning"
          : namedLinksAndButtons.length === allLinksAndButtons.length
            ? "passed"
            : "warning",
        "medium",
        `${allLinksAndButtons.length} links or buttons found; ${namedLinksAndButtons.length} have a text or ARIA name.`,
        "This source-level check counts links and buttons; it does not decide whether an action is commercially effective.",
        "Clear action labels help visitors understand their next step.",
        "Use specific labels for the actions most important to this page.",
      ),
      makeCheck(
        "conversion-form",
        "Form presence",
        forms.length > 0
          ? "passed"
          : namedLinksAndButtons.length > 0
            ? "not_measured"
            : "warning",
        "low",
        forms.length
          ? `${forms.length} form elements found.`
          : namedLinksAndButtons.length > 0
            ? "No form element was found; this may be intentional for this page."
            : "No form or named link/button was found.",
        "Only the presence of HTML forms is checked; submissions and conversion rates are not tested.",
        "Some pages use links or buttons rather than a form for the next step.",
        forms.length
          ? "Check that the form matches the page's purpose."
          : "Review the page's links and buttons for an appropriate next step.",
      ),
      makeCheck(
        "conversion-control-labels",
        "Form field clarity",
        controls.length === 0
          ? "not_measured"
          : formControlsNamed.length === controls.length
            ? "passed"
            : "warning",
        "medium",
        `${formControlsNamed.length} of ${controls.length} form controls have an accessible label.`,
        "The audit checks HTML labels and ARIA names but does not test the form flow.",
        "Clear field names can reduce confusion during a form task.",
        "Add visible labels that explain what each field needs.",
        controls.length ? "moderate" : null,
      ),
      notMeasured(
        "conversion-visibility",
        "Call-to-action visibility",
        "Visibility and prominence require a rendered page and viewport review.",
      ),
      notMeasured(
        "conversion-rate",
        "Conversion rate",
        "This audit does not collect analytics, identify visitors, or read conversion data.",
      ),
    ],
    technical: [
      makeCheck(
        "technical-http-status",
        "Page response status",
        page.status >= 200 && page.status < 300
          ? "passed"
          : page.status >= 300 && page.status < 400
            ? "warning"
            : "failed",
        "high",
        `HTTP ${page.status}`,
        "The audit records the final page response after up to four redirects.",
        "A successful response is needed for visitors and crawlers to reach the page.",
        "Resolve server errors or redirect loops if they affect intended visitors.",
      ),
      makeCheck(
        "technical-redirects",
        "Redirect count",
        classifyThreshold(page.redirectCount, 1, 3),
        "low",
        `${page.redirectCount} redirects followed.`,
        "The audit follows a maximum of four public redirects and checks each destination.",
        "Long redirect chains can add requests and make destinations harder to diagnose.",
        "Link directly to the final preferred URL where practical.",
      ),
      makeCheck(
        "technical-internal-links",
        "Sampled internal links",
        internalLinkMeasured === 0
          ? "not_measured"
          : internalLinkFailures.length === 0
            ? "passed"
            : "warning",
        "medium",
        internalLinkMeasured
          ? `${internalLinkMeasured} same-site links checked with HEAD; ${internalLinkFailures.length} returned HTTP 4xx or 5xx.`
          : "No same-site links could be measured with HEAD requests.",
        "Only the first few unique same-origin links are sampled; some sites treat HEAD differently from GET.",
        "Broken internal links can interrupt visitor journeys and crawl paths.",
        "Review the sampled links and test any HEAD-only failures with a browser.",
        internalLinkMeasured ? "moderate" : null,
      ),
      makeCheck(
        "technical-fragments",
        "In-page anchor targets",
        internalAnchors.length === 0
          ? "not_measured"
          : anchorStatus,
        "low",
        internalAnchors.length
          ? `${unresolvedAnchors} of ${internalAnchors.length} fragment links did not match an id in the HTML.`
          : null,
        "This checks fragment links against IDs in the returned document.",
        "Working in-page links help people navigate long pages.",
        "Add the missing target IDs or update the fragment links.",
        internalAnchors.length ? "easy" : null,
      ),
      makeCheck(
        "technical-robots",
        "Robots.txt availability",
        support.robots
          ? support.robots.status < 400
            ? "passed"
            : "warning"
          : "not_measured",
        "low",
        support.robots ? `HTTP ${support.robots.status}` : null,
        "Only the standard /robots.txt endpoint is requested.",
        "Crawler rules should match the site's publishing intent.",
        robotsDisallow
          ? "The file disallows all paths for at least one user-agent section; review that rule if unintended."
          : "Review the file if your crawler preferences change.",
        support.robots ? "easy" : null,
      ),
      notMeasured(
        "technical-javascript-runtime",
        "JavaScript runtime errors",
        "The audit does not run page scripts or capture browser console errors.",
      ),
      notMeasured(
        "technical-structured-app",
        "Application behavior",
        "Sign-in flows, API actions, and interactive behavior are not exercised.",
      ),
    ],
    content: [
      makeCheck(
        "content-word-count",
        "Readable text amount",
        words.length < 100
          ? "warning"
          : words.length > 7000
            ? "warning"
            : "passed",
        "low",
        `${words.length} words were found in the returned HTML text.`,
        "Text is extracted from HTML source; dynamically rendered text may not be included.",
        "People need enough relevant content to understand the page's purpose.",
        "Check that the page gives visitors the information they need without unnecessary repetition.",
      ),
      makeCheck(
        "content-paragraph-repetition",
        "Repeated paragraphs",
        paragraphs.length === 0
          ? "not_measured"
          : uniqueParagraphs.size === paragraphs.length
            ? "passed"
            : "warning",
        "low",
        `${paragraphs.length - uniqueParagraphs.size} repeated paragraphs among ${paragraphs.length} longer paragraphs.`,
        "This detects exact repeated paragraphs only; it does not judge originality or factual accuracy.",
        "Repeated copy can make a page harder to scan.",
        "Review repeated text and keep repeated legal or navigation copy intentional.",
        paragraphs.length ? "easy" : null,
      ),
      makeCheck(
        "content-heading-repetition",
        "Repeated headings",
        headings.length === 0
          ? "not_measured"
          : duplicateHeadingCount === 0
            ? "passed"
            : "warning",
        "low",
        `${duplicateHeadingCount} exact duplicate heading labels among ${headingText.length} headings.`,
        "This check finds exact duplicate heading text only.",
        "Specific headings can make a long page easier to navigate.",
        "Make repeated headings specific where they introduce different content.",
        headings.length ? "easy" : null,
      ),
      makeCheck(
        "content-title-description",
        "Search snippet copy",
        title && description ? "passed" : "warning",
        "low",
        `Title: ${title ? "present" : "missing"}; description: ${description ? "present" : "missing"}.`,
        "The audit checks whether the page has title and description text, not whether claims are accurate.",
        "Clear summaries set expectations before a visit.",
        "Write a concise summary that accurately reflects this page.",
      ),
      notMeasured(
        "content-factual-accuracy",
        "Factual accuracy",
        "Claims are not independently verified against external sources.",
      ),
      notMeasured(
        "content-readability",
        "Reading level",
        "A reliable readability score requires language-aware text analysis that this audit does not perform.",
      ),
    ],
  };

  const categories = PUBLIC_AUDIT_CATEGORIES.map(({ key }) =>
    scorePublicAuditCategory(key, resultByKey[key]),
  );
  const scoredCategories = categories
    .map((category) => category.score)
    .filter((score): score is number => score !== null);
  const allChecks = categories.flatMap((category) => category.checks);
  const actionPlan = allChecks
    .filter(
      (check) =>
        ["failed", "warning"].includes(check.status) &&
        check.priority < 5 &&
        check.recommendation,
    )
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.status === "failed" ? -1 : 1) -
          (b.status === "failed" ? -1 : 1),
    )
    .slice(0, 5)
    .map((check) => ({
      title: check.title,
      category:
        categories.find((category) =>
          category.checks.some((candidate) => candidate.id === check.id),
        )?.title ?? "Website health",
      priority: check.priority,
      impact: check.impact,
      difficulty: check.difficulty,
      reason: check.recommendation,
    }));

  return {
    url: page.requestedUrl,
    finalUrl: base,
    checkedAt: new Date().toISOString(),
    overallScore:
      scoredCategories.length > 0
        ? Math.round(
            scoredCategories.reduce((sum, score) => sum + score, 0) /
              scoredCategories.length,
          )
        : null,
    categories,
    actionPlan,
    recommendation: {
      plan: "Standard",
      priceEur: 29,
      reason:
        "This check covers one public page. Standard is the closest match for ongoing automated SEO audits. A single-page scan cannot tell whether you need multiple locations, Google Analytics 4, or white-label reporting, so compare Pro or Ultra only if those capabilities fit your team.",
      href: PUBLIC_AUDIT_STANDARD_SIGNUP_URL,
    },
    quota,
  };
}

export function getPublicAuditFailureMessage(error: unknown): string {
  if (!(error instanceof PublicAuditTargetError)) {
    return "The audit could not be completed. Please try again later.";
  }
  switch (error.code) {
    case "invalid_url":
      return "Enter a public website that returns an HTML page.";
    case "blocked_destination":
    case "cross_origin_redirect":
      return "This destination could not be checked safely.";
    case "too_many_redirects":
      return "This website redirected too many times to complete the check.";
    case "timeout":
      return "The website took too long to respond. Please try again later.";
    case "response_too_large":
      return "The page is too large for this free check.";
    default:
      return "The website could not be reached. Please check the address and try again.";
  }
}
