import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import type {
  PublicAuditCheck,
  PublicAuditQuota,
} from "@shared/public-audit";
import {
  normalizePublicAuditUrl,
  PublicAuditTargetError,
  type PublicFetchOptions,
  type PublicFetchResult,
} from "./public-audit-fetch";
import {
  createPublicAuditReport,
  getPublicAuditFailureMessage,
  PUBLIC_AUDIT_STANDARD_SIGNUP_URL,
  scorePublicAuditCategory,
} from "./public-audit-report";

const quota: PublicAuditQuota = {
  remaining: 2,
  limit: 3,
  resetAt: "2026-11-19T00:00:00.000Z",
};

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

function createFixtureFetcher() {
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
    if (url.pathname === "/") {
      return response(
        url.toString(),
        gzipSync(pageHtml),
        {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
          "strict-transport-security": "max-age=31536000",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      );
    }
    if (url.pathname === "/robots.txt") {
      return response(url.toString(), "User-agent: *\nAllow: /\n", {
        "content-type": "text/plain",
      });
    }
    if (url.pathname === "/sitemap.xml") {
      return response(url.toString(), "<urlset></urlset>", {
        "content-type": "application/xml",
      });
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
  assert.equal(report.recommendation.plan, "Standard");
  assert.equal(report.recommendation.priceEur, 29);
  assert.equal(
    report.recommendation.href,
    "https://app.flowpoint.pro/signin.html?plan=standard",
  );
  assert.equal(report.recommendation.href, PUBLIC_AUDIT_STANDARD_SIGNUP_URL);
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
  assert.equal(status("accessibility-image-alt"), "failed");
  assert.equal(status("security-form-actions"), "failed");
  assert.equal(status("mobile-viewport"), "failed");
  assert.equal(status("mobile-overflow"), "not_measured");
  assert.ok(report.actionPlan.length > 0);
  assert.ok(report.actionPlan.every((action) => action.priority < 5));
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
});
