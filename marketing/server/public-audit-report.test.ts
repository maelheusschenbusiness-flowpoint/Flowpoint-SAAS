import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import type {
  PublicAuditCategory,
  PublicAuditCheck,
  PublicAuditQuota,
} from "@shared/public-audit";
import { PUBLIC_AUDIT_CATEGORIES } from "@shared/public-audit";
import {
  normalizePublicAuditUrl,
  PublicAuditTargetError,
  sanitizePublicAuditUrlForLog,
  type PublicFetchOptions,
  type PublicFetchResult,
} from "./public-audit-fetch";
import {
  createPublicAuditReport,
  getPublicAuditFailureMessage,
  PUBLIC_AUDIT_STANDARD_SIGNUP_URL,
  scorePublicAuditCategory,
  scorePublicAuditOverall,
} from "./public-audit-report";

const quota: PublicAuditQuota = {
  remaining: 2,
  limit: 3,
  resetAt: "2026-11-19T00:00:00.000Z",
};

type FixtureOptions = {
  html?: string;
  invalidGzip?: boolean;
  pageStatus?: number;
  pageHeaders?: Record<string, string>;
  finalUrl?: string;
  redirectCount?: number;
  networkFailures?: string[];
  headUnsupported?: string[];
  robotsBody?: string;
  robotsStatus?: number;
  sitemapStatus?: number;
};

function makeCheck(
  id: string,
  status: PublicAuditCheck["status"],
  severity: PublicAuditCheck["severity"] = "medium",
): PublicAuditCheck {
  return {
    id,
    title: id,
    status,
    severity,
    evidence: status === "not_measured" ? null : "Fixture evidence",
    explanation: "Fixture explanation",
    impact: "Fixture impact",
    recommendation: "Fixture recommendation",
    priority: 99,
    difficulty: null,
  };
}

function checksForRatio(passed: number, total: number): PublicAuditCheck[] {
  return Array.from({ length: total }, (_, index) =>
    makeCheck(`ratio-${index}`, index < passed ? "passed" : "failed"),
  );
}

const pageHtml = `<!doctype html>
<html lang="en">
  <head>
    <title>Fieldwork Studio</title>
    <meta name="description" content="A clear description of the Fieldwork Studio website and its services.">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="https://audit.example/">
    <link rel="stylesheet" href="/site.css">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Fieldwork Studio"}</script>
  </head>
  <body>
    <h1>Fieldwork Studio</h1>
    <h2 id="overview">Our work</h2>
    <p>${Array.from({ length: 180 }, (_, index) => `useful information ${index}`).join(" ")}</p>
    <img src="/images/hero.jpg" srcset="/images/hero-small.jpg 480w" sizes="100vw" alt="Fieldwork team at work">
    <a href="/about#intro">About the studio</a>
    <a href="#overview">Read about our work</a>
    <form action="/contact" method="post">
      <label for="contact-email">Email address</label>
      <input id="contact-email" name="email" type="email">
      <button type="submit">Send a message</button>
    </form>
  </body>
</html>`;

function response(
  requestedUrl: string,
  body: string | Buffer,
  headers: Record<string, string>,
  status = 200,
  transferBytes = Buffer.isBuffer(body) ? body.byteLength : Buffer.byteLength(body),
): PublicFetchResult {
  const url = normalizePublicAuditUrl(requestedUrl);
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    requestedUrl: url.toString(),
    finalUrl: url.toString(),
    status,
    headers: headers as PublicFetchResult["headers"],
    body: bodyBuffer,
    ttfbMs: 45,
    transferBytes,
    redirectCount: 0,
  };
}

function createFixtureFetcher(fixture: FixtureOptions = {}) {
  const requests: Array<{ url: string; method: string }> = [];
  const fetcher = async (
    input: string,
    options: PublicFetchOptions = {},
  ): Promise<PublicFetchResult> => {
    const url = normalizePublicAuditUrl(input);
    requests.push({ url: url.toString(), method: options.method ?? "GET" });

    if (url.origin !== "https://audit.example") {
      throw new Error("The report requested a resource outside its origin.");
    }
    if (fixture.networkFailures?.includes(url.pathname)) {
      throw new Error(`Fixture network failure at ${url.pathname}`);
    }
    if (
      options.method === "HEAD" &&
      fixture.headUnsupported?.includes(url.pathname)
    ) {
      return response(url.toString(), "", {}, 405, 0);
    }
    if (url.pathname === "/") {
      const pageBody = fixture.invalidGzip
        ? Buffer.from("not a gzip stream")
        : gzipSync(fixture.html ?? pageHtml);
      const page = response(
        url.toString(),
        pageBody,
        {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
          "strict-transport-security": "max-age=31536000",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
          "referrer-policy": "strict-origin-when-cross-origin",
          ...fixture.pageHeaders,
        },
        fixture.pageStatus ?? 200,
      );
      return {
        ...page,
        finalUrl: normalizePublicAuditUrl(fixture.finalUrl ?? url.toString()).toString(),
        redirectCount: fixture.redirectCount ?? 0,
      };
    }
    if (url.pathname === "/robots.txt") {
      return response(
        url.toString(),
        fixture.robotsBody ?? "User-agent: *\nAllow: /\n",
        { "content-type": "text/plain" },
        fixture.robotsStatus ?? 200,
      );
    }
    if (url.pathname === "/sitemap.xml") {
      return response(
        url.toString(),
        "<urlset></urlset>",
        { "content-type": "application/xml" },
        fixture.sitemapStatus ?? 200,
      );
    }
    if (url.pathname === "/site.css") {
      return response(
        url.toString(),
        "@media (max-width: 600px) { body { padding: 1rem; } }",
        { "content-type": "text/css" },
      );
    }
    if (
      url.pathname === "/images/hero.jpg" ||
      url.pathname === "/about"
    ) {
      return response(
        url.toString(),
        "",
        {
          "content-type":
            url.pathname === "/about" ? "text/html" : "image/jpeg",
          "content-length": "12000",
        },
        200,
        0,
      );
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  return { fetcher, requests };
}

test("report uses page evidence, returns eight categories, and marks unavailable measures", async () => {
  const { fetcher, requests } = createFixtureFetcher();
  const report = await createPublicAuditReport(
    "https://audit.example/?email=private@example.test#overview",
    quota,
    undefined,
    fetcher,
  );

  assert.equal(report.url, "https://audit.example/");
  assert.equal(report.finalUrl, "https://audit.example/");
  assert.equal(report.categories.length, 8);
  assert.ok(report.overallScore !== null);
  assert.deepEqual(report.coverage, {
    measuredChecks: report.categories.reduce(
      (sum, category) => sum + category.coverage.measuredChecks,
      0,
    ),
    totalChecks: report.categories.reduce(
      (sum, category) => sum + category.coverage.totalChecks,
      0,
    ),
    scoredCategories: 8,
    totalCategories: 8,
  });
  assert.equal(report.recommendation.plan, "Standard");
  assert.equal(report.recommendation.priceEur, 29);
  assert.equal(
    report.recommendation.href,
    "https://app.flowpoint.pro/signin.html?plan=standard",
  );
  assert.equal(report.recommendation.href, PUBLIC_AUDIT_STANDARD_SIGNUP_URL);
  assert.deepEqual(
    report.recommendation.planLinks.map(({ plan, href }) => [plan, href]),
    [
      ["Standard", "https://app.flowpoint.pro/signin.html?plan=standard"],
      ["Pro", "https://app.flowpoint.pro/signin.html?plan=pro"],
      ["Ultra", "https://app.flowpoint.pro/signin.html?plan=ultra"],
    ],
  );
  assert.doesNotMatch(report.recommendation.reason, /\badd[ -]?ons?\b/i);

  const check = (id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id);
  assert.equal(check("seo-title")?.status, "passed");
  assert.equal(check("seo-heading")?.status, "passed");
  assert.equal(check("accessibility-control-labels")?.status, "passed");
  assert.equal(check("mobile-media-queries")?.status, "passed");
  assert.equal(check("mobile-overflow")?.status, "not_measured");
  assert.equal(check("conversion-rate")?.status, "not_measured");
  assert.equal(check("performance-compression")?.status, "passed");
  assert.equal(check("performance-resource-availability")?.status, "passed");
  assert.equal(check("security-csp")?.status, "passed");
  assert.equal(report.overallScore, 100);
  assert.equal(report.categories.filter((category) => category.score !== null).length, 8);
  assert.equal(report.actionPlan.length, 0);
  assert.ok(requests.some((request) => request.url.endsWith("/site.css")));
  assert.ok(requests.some((request) => request.url.endsWith("/images/hero.jpg") && request.method === "HEAD"));
  assert.ok(requests.every((request) => new URL(request.url).origin === "https://audit.example"));
});

test("controlled broken page scores lower and surfaces measured problems", async () => {
  const brokenHtml = `<!doctype html>
<html><head></head><body>
  <h3>Details</h3><h3>Details</h3>
  <p>Short repeated copy with very little useful information.</p>
  <p>Short repeated copy with very little useful information.</p>
  <a href="/missing"></a><a href="#missing">Jump to missing content</a>
  <form action="http://broken.example/submit"><input type="text"></form>
  <button></button>
  <img src="http://broken.example/mixed.png">
  ${Array.from({ length: 60 }, (_, index) => `<img src="/image-${index}.jpg">`).join("")}
</body></html>`;
  const fetcher = async (
    input: string,
    options: PublicFetchOptions = {},
  ): Promise<PublicFetchResult> => {
    const url = normalizePublicAuditUrl(input);
    assert.equal(url.origin, "https://broken.example");
    if (url.pathname === "/") {
      return {
        ...response(
          url.toString(),
          brokenHtml,
          { "content-type": "text/html; charset=utf-8" },
          200,
          450_000,
        ),
        ttfbMs: 2_500,
      };
    }
    if (url.pathname === "/robots.txt") {
      return response(url.toString(), "User-agent: *\nDisallow: /\n", {
        "content-type": "text/plain",
      });
    }
    if (url.pathname === "/sitemap.xml") {
      return response(url.toString(), "missing", { "content-type": "text/plain" }, 404);
    }
    if (url.pathname.startsWith("/image-")) {
      return response(url.toString(), "", { "content-length": "12000" }, 200, 0);
    }
    if (url.pathname === "/missing") {
      return response(url.toString(), "missing", { "content-type": "text/html" }, 404);
    }
    if (options.method === "HEAD") {
      return response(url.toString(), "", {}, 404, 0);
    }
    throw new Error(`Unexpected controlled-fixture request: ${url.pathname}`);
  };

  const report = await createPublicAuditReport(
    "https://broken.example/",
    quota,
    undefined,
    fetcher,
  );
  const score = (key: string) =>
    report.categories.find((category) => category.key === key)?.score ?? null;
  const status = (id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id)?.status;

  assert.ok(report.overallScore !== null && report.overallScore < 70);
  assert.ok(score("seo") !== null && score("seo")! < 70);
  assert.ok(score("security") !== null && score("security")! < 60);
  assert.ok(score("performance") !== null && score("performance")! < 50);
  assert.equal(status("seo-title"), "failed");
  assert.equal(status("seo-description"), "failed");
  assert.equal(status("seo-canonical"), "warning");
  assert.equal(status("accessibility-image-alt"), "failed");
  assert.equal(status("security-form-actions"), "failed");
  assert.equal(status("mobile-viewport"), "failed");
  assert.equal(status("mobile-overflow"), "not_measured");
  assert.ok(report.actionPlan.length > 0);
  assert.ok(report.actionPlan.every((action) => action.priority < 5));
});

test("page status and redirect evidence use the final HTTP response", async () => {
  for (const status of [404, 503]) {
    await assert.rejects(
      () =>
        createPublicAuditReport(
          "https://audit.example/",
          quota,
          undefined,
          createFixtureFetcher({ pageStatus: status }).fetcher,
        ),
      (error) =>
        error instanceof PublicAuditTargetError &&
        error.code === "http_error" &&
        error.httpStatus === status &&
        getPublicAuditFailureMessage(error).includes(`HTTP ${status}`),
    );
  }

  await assert.rejects(
    () =>
      createPublicAuditReport(
        "https://audit.example/",
        quota,
        undefined,
        createFixtureFetcher({
          pageStatus: 503,
          finalUrl: "https://audit.example/final-page",
          redirectCount: 2,
        }).fetcher,
      ),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "http_error" &&
      error.httpStatus === 503,
  );

  const redirected = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({
      finalUrl: "https://audit.example/final-page",
      redirectCount: 2,
    }).fetcher,
  );
  const getCheck = (report: Awaited<ReturnType<typeof createPublicAuditReport>>, id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id);
  assert.equal(redirected.finalUrl, "https://audit.example/final-page");
  assert.equal(getCheck(redirected, "technical-redirects")?.status, "warning");
  assert.equal(getCheck(redirected, "technical-redirects")?.evidence, "2 redirects followed.");
});

test("an HTML 404 response fails clearly before generating a partial report", async () => {
  const { fetcher, requests } = createFixtureFetcher({
    pageStatus: 404,
    html: pageHtml,
  });
  await assert.rejects(
    () => createPublicAuditReport("https://audit.example/", quota, undefined, fetcher),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "http_error" &&
      error.httpStatus === 404 &&
      getPublicAuditFailureMessage(error).includes("HTTP 404"),
  );
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), ["/"]);
});

test("an unpublished Replit placeholder is identified without auditing its HTML", async () => {
  const { fetcher, requests } = createFixtureFetcher({
    pageStatus: 404,
    finalUrl: "https://audit.example/",
    html: `<!doctype html>
      <html><head><title>This app isn&#39;t live yet</title></head>
      <body><style>
        @font-face { font-family: "Replit Diatype"; src: url("/__replco/static/fonts/example.woff2"); }
      </style></body></html>`,
  });

  await assert.rejects(
    () => createPublicAuditReport("https://audit.example/", quota, undefined, fetcher),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "hosting_placeholder" &&
      error.httpStatus === 404 &&
      error.finalUrl === "https://audit.example/" &&
      error.contentType === "text/html; charset=utf-8" &&
      getPublicAuditFailureMessage(error).includes("unpublished hosting placeholder"),
  );
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), ["/"]);
});

test("audit log URLs omit queries and redact path segments", () => {
  assert.equal(
    sanitizePublicAuditUrlForLog(
      "https://audit.example/users/person%40example.com/session/123456?access_token=private",
    ),
    "https://audit.example/[redacted]/[redacted]/[redacted]/[redacted]",
  );
});

test("a successful response with an explicit crawler challenge fails clearly", async () => {
  const { fetcher } = createFixtureFetcher({
    pageHeaders: { "cf-mitigated": "challenge" },
  });
  await assert.rejects(
    () => createPublicAuditReport("https://audit.example/", quota, undefined, fetcher),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "crawler_blocked" &&
      getPublicAuditFailureMessage(error).includes("bot-verification challenge"),
  );
});

test("a successful soft-error page is not reported as an audited page", async () => {
  const { fetcher } = createFixtureFetcher({
    html: "<!doctype html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>",
  });
  await assert.rejects(
    () => createPublicAuditReport("https://audit.example/", quota, undefined, fetcher),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "error_page" &&
      getPublicAuditFailureMessage(error).includes("error page"),
  );
});

test("empty or unreadable HTML responses produce clear retrieval errors", async () => {
  const empty = createFixtureFetcher({ html: " \n " }).fetcher;
  await assert.rejects(
    () => createPublicAuditReport("https://audit.example/", quota, undefined, empty),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "empty_response" &&
      getPublicAuditFailureMessage(error).includes("no HTML content"),
  );

  const unreadable = createFixtureFetcher({ invalidGzip: true }).fetcher;
  await assert.rejects(
    () => createPublicAuditReport("https://audit.example/", quota, undefined, unreadable),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "unreadable_response" &&
      getPublicAuditFailureMessage(error).includes("could not decode"),
  );
});

test("meta description and canonical checks flag duplicate contradictory HTML", async () => {
  const html = pageHtml
    .replace(
      '<meta name="description" content="A clear description of the Fieldwork Studio website and its services.">',
      '<meta name="description" content="First summary"><meta name="description" content="Second summary">',
    )
    .replace(
      '<link rel="canonical" href="https://audit.example/">',
      '<link rel="alternate canonical" href="https://audit.example/first"><link rel="canonical" href="https://other.example/second">',
    );
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({ html }).fetcher,
  );
  const checks = report.categories.flatMap((category) => category.checks);
  const description = checks.find((check) => check.id === "seo-description");
  const canonical = checks.find((check) => check.id === "seo-canonical");
  assert.equal(description?.status, "warning");
  assert.match(description?.evidence ?? "", /2 meta description tags/);
  assert.match(description?.recommendation ?? "", /one page-specific/);
  assert.equal(canonical?.status, "warning");
  assert.match(canonical?.evidence ?? "", /2 canonical links/);
  assert.ok(
    report.actionPlan.some(
      (action) =>
        action.title === "Meta description" &&
        action.severity === "medium" &&
        Boolean(action.evidence) &&
        Boolean(action.impact) &&
        Boolean(action.reason),
    ),
  );
});

test("identical duplicate SEO tags are reported as redundant, not conflicting", async () => {
  const description = '<meta name="description" content="A clear description of the Fieldwork Studio website and its services.">';
  const canonical = '<link rel="canonical" href="https://audit.example/">';
  const html = pageHtml
    .replace(description, `${description}${description}`)
    .replace(canonical, `${canonical}${canonical}`);
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({ html }).fetcher,
  );
  const check = (id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id);

  assert.equal(check("seo-description")?.status, "warning");
  assert.equal(check("seo-description")?.severity, "low");
  assert.match(check("seo-description")?.evidence ?? "", /identical.*text agrees/i);
  assert.doesNotMatch(check("seo-description")?.evidence ?? "", /conflict/i);
  assert.equal(check("seo-canonical")?.status, "warning");
  assert.equal(check("seo-canonical")?.severity, "low");
  assert.match(check("seo-canonical")?.evidence ?? "", /same URL; the target is consistent/i);
  assert.match(check("content-title-description")?.evidence ?? "", /duplicate but consistent/i);
});

test("canonical rel tokens are recognized without exposing query parameters", async () => {
  const html = pageHtml.replace(
    '<link rel="canonical" href="https://audit.example/">',
    '<link rel="alternate CANONICAL" href="/preferred?visitor=private-token">',
  );
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({ html }).fetcher,
  );
  const canonical = report.categories
    .flatMap((category) => category.checks)
    .find((check) => check.id === "seo-canonical");
  assert.equal(canonical?.status, "passed");
  assert.match(canonical?.evidence ?? "", /https:\/\/audit\.example\/preferred\.$/);
  assert.doesNotMatch(canonical?.evidence ?? "", /private-token|visitor=/);
});

test("failed supporting requests stay unmeasured or report retrieval warnings", async () => {
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({
      networkFailures: [
        "/robots.txt",
        "/sitemap.xml",
        "/site.css",
        "/images/hero.jpg",
        "/about",
      ],
    }).fetcher,
  );
  const check = (id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id);
  assert.equal(check("seo-robots")?.status, "not_measured");
  assert.equal(check("seo-sitemap")?.status, "not_measured");
  assert.equal(check("mobile-media-queries")?.status, "not_measured");
  assert.equal(check("performance-resource-availability")?.status, "warning");
  assert.equal(check("technical-internal-links")?.status, "warning");
  assert.match(
    check("technical-internal-links")?.evidence ?? "",
    /1 of 2 sampled.*1 could not be reached/,
  );
});

test("missing optional robots and unadvertised sitemap files do not count as SEO failures", async () => {
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({ robotsStatus: 404, sitemapStatus: 404 }).fetcher,
  );
  const check = (id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id);

  assert.equal(check("seo-robots")?.status, "passed");
  assert.match(check("seo-robots")?.evidence ?? "", /HTTP 404/);
  assert.equal(check("technical-robots")?.status, "passed");
  assert.equal(check("seo-sitemap")?.status, "passed");
  assert.match(check("seo-sitemap")?.evidence ?? "", /no same-origin sitemap was advertised/);
});

test("GET status-only fallback measures assets and links when HEAD is unsupported", async () => {
  const { fetcher, requests } = createFixtureFetcher({
    headUnsupported: ["/images/hero.jpg", "/about"],
  });
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    fetcher,
  );
  const check = (id: string) =>
    report.categories.flatMap((category) => category.checks).find((item) => item.id === id);

  assert.equal(check("performance-resource-availability")?.status, "passed");
  assert.equal(check("technical-internal-links")?.status, "passed");
  assert.ok(
    requests.some(({ url, method }) =>
      new URL(url).pathname === "/images/hero.jpg" && method === "GET",
    ),
  );
  assert.ok(
    requests.some(({ url, method }) =>
      new URL(url).pathname === "/about" && method === "GET",
    ),
  );
});

test("an advertised sitemap that returns 404 remains a warning", async () => {
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({
      robotsBody:
        "User-agent: *\nAllow: /\nSitemap: https://audit.example/sitemap.xml\n",
      sitemapStatus: 404,
    }).fetcher,
  );
  const sitemap = report.categories
    .flatMap((category) => category.checks)
    .find((item) => item.id === "seo-sitemap");

  assert.equal(sitemap?.status, "warning");
  assert.match(sitemap?.evidence ?? "", /HTTP 404/);
});

test("a sitemap directive outside the page origin is not fetched or inferred", async () => {
  const { fetcher, requests } = createFixtureFetcher({
    robotsBody:
      "User-agent: *\nAllow: /\nSitemap: https://cdn.example/sitemap.xml\n",
  });
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    fetcher,
  );
  const sitemap = report.categories
    .flatMap((category) => category.checks)
    .find((item) => item.id === "seo-sitemap");

  assert.equal(sitemap?.status, "not_measured");
  assert.match(sitemap?.evidence ?? "", /safe same-origin URL; it was not fetched/);
  assert.ok(!requests.some(({ url }) => url.startsWith("https://cdn.example/")));
  assert.ok(
    !requests.some(
      ({ url }) => new URL(url).pathname === "/sitemap.xml",
    ),
  );
});

test("an empty but retrievable page reports its observable source checks", async () => {
  const report = await createPublicAuditReport(
    "https://audit.example/",
    quota,
    undefined,
    createFixtureFetcher({
      html: "<!doctype html><html><head></head><body></body></html>",
      networkFailures: ["/robots.txt", "/sitemap.xml"],
    }).fetcher,
  );
  assert.ok(report.overallScore !== null);
  assert.ok(report.coverage.scoredCategories > 3);
  assert.equal(report.coverage.totalCategories, 8);
  assert.equal(
    report.categories.find((category) => category.key === "mobile")?.status,
    "not_measured",
  );
  const checks = report.categories.flatMap((category) => category.checks);
  assert.equal(checks.find((item) => item.id === "accessibility-image-alt")?.status, "passed");
  assert.equal(checks.find((item) => item.id === "technical-fragments")?.status, "passed");
  assert.equal(checks.find((item) => item.id === "mobile-overflow")?.status, "not_measured");
});

test("category scoring excludes not-measured checks", () => {
  const checks: PublicAuditCheck[] = [
    {
      id: "passed",
      title: "Passed",
      status: "passed",
      severity: "high",
      evidence: "Measured",
      explanation: "",
      impact: "",
      recommendation: "",
      priority: 99,
      difficulty: null,
    },
    {
      id: "warning",
      title: "Warning",
      status: "warning",
      severity: "medium",
      evidence: "Measured",
      explanation: "",
      impact: "",
      recommendation: "",
      priority: 99,
      difficulty: null,
    },
    {
      id: "failed",
      title: "Failed",
      status: "failed",
      severity: "low",
      evidence: "Measured",
      explanation: "",
      impact: "",
      recommendation: "",
      priority: 99,
      difficulty: null,
    },
    {
      id: "unmeasured",
      title: "Unmeasured",
      status: "not_measured",
      severity: "info",
      evidence: null,
      explanation: "",
      impact: "",
      recommendation: "",
      priority: 99,
      difficulty: null,
    },
  ];
  const category = scorePublicAuditCategory("seo", checks);
  assert.equal(category.score, 67);
  assert.equal(category.status, "partial");
  assert.deepEqual(category.coverage, { measuredChecks: 3, totalChecks: 4 });
});

test("insufficient check coverage leaves the category explicitly unmeasured", () => {
  const checks = [
    makeCheck("pass", "passed"),
    makeCheck("fail", "failed"),
    ...Array.from({ length: 6 }, (_, index) =>
      makeCheck(`unmeasured-${index}`, "not_measured", "info"),
    ),
  ];
  const category = scorePublicAuditCategory("seo", checks);
  assert.equal(category.score, null);
  assert.equal(category.status, "not_measured");
  assert.deepEqual(category.coverage, { measuredChecks: 2, totalChecks: 8 });
  assert.match(category.summary, /not enough evidence to score/);
});

test("synthetic scoring math matches the supplied 30, 71, and 73 reference values", () => {
  // These synthetic checks exercise the reported numbers; they do not verify
  // the user-supplied report's underlying observations.
  const technical30 = [
    makeCheck("technical-pass-a", "passed", "low"),
    makeCheck("technical-pass-b", "passed", "low"),
    makeCheck("technical-review", "warning", "medium"),
    makeCheck("technical-fail-a", "failed", "high"),
    makeCheck("technical-fail-b", "failed", "high"),
  ];
  const targetScores = [71, 30, 95, 90, 85, 80, 75, 58];
  const categories: PublicAuditCategory[] = targetScores.map((_, index) => {
    const key = PUBLIC_AUDIT_CATEGORIES[index].key;
    const checks =
      index === 0
        ? checksForRatio(5, 7)
        : index === 1
          ? technical30
          : index === 2
            ? checksForRatio(19, 20)
            : index === 3
              ? checksForRatio(9, 10)
              : index === 4
                ? checksForRatio(17, 20)
                : index === 5
                  ? checksForRatio(8, 10)
                  : index === 6
                    ? checksForRatio(3, 4)
                    : checksForRatio(7, 12);
    return scorePublicAuditCategory(key, checks);
  });
  assert.deepEqual(categories.map((category) => category.score), targetScores);
  assert.equal(scorePublicAuditOverall(categories), 73);
  assert.equal(scorePublicAuditOverall(categories.slice(0, 3)), null);
});

test("report errors retain safe visitor-facing messages", async () => {
  await assert.rejects(
    () =>
      createPublicAuditReport(
        "https://audit.example/",
        quota,
        undefined,
        async () => {
          throw new PublicAuditTargetError("timeout");
        },
      ),
    (error) =>
      error instanceof PublicAuditTargetError &&
      getPublicAuditFailureMessage(error).includes("too long"),
  );
  assert.equal(
    getPublicAuditFailureMessage(new Error("private detail")),
    "The audit could not be completed. Please try again later.",
  );
  await assert.rejects(
    () =>
      createPublicAuditReport(
        "https://audit.example/",
        quota,
        undefined,
        async () => {
          throw new Error("fixture network failure");
        },
      ),
    (error) =>
      error instanceof PublicAuditTargetError &&
      error.code === "connection_failed" &&
      getPublicAuditFailureMessage(error).includes("could not be reached"),
  );
});
