#!/usr/bin/env python3
"""Validate the published SEO article clusters against a local or public base URL.

Run locally with:
  SEO_BASE_URL=http://127.0.0.1:8080 npm run seo:validate

Run against the public site with:
  npm run seo:validate
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree


CLUSTERS = {
    "SEO Audit": [
        "how-to-perform-website-seo-audit",
        "technical-seo-audit-checklist",
        "interpret-seo-audit-results",
        "seo-content-audit",
        "small-business-seo-audit-priorities",
        "website-seo-audit-frequency",
    ],
    "Local SEO": [
        "local-seo-guide",
        "optimize-google-business-profile",
        "local-seo-audit",
        "google-maps-rankings",
        "local-seo-keywords",
        "local-seo-pages",
        "google-reviews-local-seo",
        "local-seo-rank-tracking",
    ],
    "SEO Monitoring": [
        "seo-monitoring-guide",
        "website-monitoring-metrics",
        "website-uptime-monitoring",
        "website-monitoring-alerts",
        "website-performance-tracking",
        "automated-seo-monitoring",
        "seo-audit-vs-monitoring",
        "choose-seo-monitoring-tool",
    ],
    "SEO Reporting": [
        "seo-reporting-guide",
        "automated-seo-report",
        "seo-kpi-dashboard",
        "google-search-console-report",
        "small-business-seo-reporting",
        "monthly-seo-report",
        "client-seo-reporting",
        "choose-seo-reporting-tool",
    ],
    "SEO Competitor Analysis": [
        "seo-competitor-analysis-guide",
        "identify-seo-competitors",
        "competitor-keyword-analysis",
        "competitor-content-analysis",
        "seo-benchmark-metrics",
        "competitor-backlink-analysis",
        "competitor-seo-opportunities",
        "choose-seo-competitor-analysis-tool",
    ],
}

LANDINGS = [
    "/seo-audit",
    "/local-seo",
    "/website-monitoring",
    "/seo-reporting",
    "/competitor-analysis",
]

LANDING_ARTICLE_LINKS = {
    "/website-monitoring": [
        "seo-monitoring-guide",
        "website-monitoring-metrics",
        "website-monitoring-alerts",
    ],
    "/seo-reporting": [
        "seo-reporting-guide",
        "seo-kpi-dashboard",
        "google-search-console-report",
    ],
    "/competitor-analysis": [
        "seo-competitor-analysis-guide",
        "identify-seo-competitors",
        "competitor-seo-opportunities",
    ],
}

TEST_SLUGS = {
    "certification-infrastructure-articles",
    "unpublished-test-draft",
}
RESOURCE_HUB = "/resources"
CANONICAL_ORIGIN = "https://flowpoint.pro"


class PageParser(HTMLParser):
    """Small real HTML parser for SEO head data, schemas, and links."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.title_count = 0
        self.in_title = False
        self.h1_parts: list[str] = []
        self.h1_values: list[str] = []
        self.in_h1 = False
        self.html_lang = ""
        self.meta: dict[str, list[str]] = {}
        self.open_graph: dict[str, list[str]] = {}
        self.canonicals: list[str] = []
        self.hreflangs: list[tuple[str, str]] = []
        self.hrefs: list[str] = []
        self.jsonld: list[str] = []
        self.current_jsonld: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.html_lang = values.get("lang") or ""
        elif tag == "title":
            self.title_count += 1
            self.title_parts = []
            self.in_title = True
        elif tag == "h1":
            self.h1_parts = []
            self.in_h1 = True
        elif tag == "meta":
            name = (values.get("name") or "").strip().lower()
            prop = (values.get("property") or "").strip().lower()
            content = values.get("content") or ""
            if name:
                self.meta.setdefault(name, []).append(content)
            if prop:
                self.open_graph.setdefault(prop, []).append(content)
        elif tag == "link":
            rel = (values.get("rel") or "").lower().split()
            if "canonical" in rel:
                self.canonicals.append(values.get("href") or "")
            if "alternate" in rel and values.get("hreflang"):
                self.hreflangs.append(
                    (values["hreflang"] or "", values.get("href") or "")
                )
        elif tag == "a" and values.get("href"):
            self.hrefs.append(values["href"] or "")

        if tag == "script" and (values.get("type") or "").lower() == "application/ld+json":
            self.current_jsonld = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        elif tag == "h1":
            self.in_h1 = False
            self.h1_values.append("".join(self.h1_parts).strip())
        elif tag == "script" and self.current_jsonld is not None:
            self.jsonld.append("".join(self.current_jsonld))
            self.current_jsonld = None

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        if self.in_h1:
            self.h1_parts.append(data)
        if self.current_jsonld is not None:
            self.current_jsonld.append(data)

    @property
    def title(self) -> str:
        return "".join(self.title_parts).strip()


def schema_types(parser: PageParser) -> list[str]:
    found: list[str] = []

    def visit(value: object) -> None:
        if isinstance(value, dict):
            schema_type = value.get("@type")
            if isinstance(schema_type, str):
                found.append(schema_type)
            elif isinstance(schema_type, list):
                found.extend(item for item in schema_type if isinstance(item, str))
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    for raw in parser.jsonld:
        visit(json.loads(raw))
    return found


def fetch(base_url: str, path: str, timeout: float) -> tuple[int, str]:
    url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    request = Request(url, headers={"User-Agent": "Flowpoint-SEO-Validation/1.0"})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (URLError, TimeoutError, OSError) as error:
        return 0, str(error)


def internal_path(href: str, base_url: str) -> str | None:
    candidate = urlsplit(urljoin(base_url.rstrip("/") + "/", href))
    if candidate.scheme not in ("http", "https"):
        return None
    base_host = (urlsplit(base_url).hostname or "").lower()
    host = (candidate.hostname or "").lower()
    allowed_hosts = {base_host, "flowpoint.pro"}
    if host not in allowed_hosts:
        return None
    return candidate.path or "/"


def parse_page(
    base_url: str,
    path: str,
    timeout: float,
    errors: list[str],
) -> tuple[str, PageParser | None]:
    status, body = fetch(base_url, path, timeout)
    if status != 200:
        errors.append(f"HTTP {status or 'ERREUR'} {path}: {body[:180]}")
        return body, None
    parser = PageParser()
    try:
        parser.feed(body)
        parser.close()
    except Exception as error:  # pragma: no cover - parser errors are reported
        errors.append(f"HTML illisible {path}: {error}")
        return body, None
    if not parser.h1_values or not any(parser.h1_values):
        errors.append(f"H1 SSR manquant {path}")
    if parser.html_lang != "en":
        errors.append(f"HTML SSR non anglais {path}: lang={parser.html_lang or 'absent'}")
    return body, parser


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("SEO_BASE_URL", "https://flowpoint.pro"),
        help="Base URL for the published site or a local production build.",
    )
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    article_slugs = [slug for slugs in CLUSTERS.values() for slug in slugs]
    article_paths = [f"{RESOURCE_HUB}/{slug}" for slug in article_slugs]
    page_paths = [RESOURCE_HUB, *article_paths, *LANDINGS]
    errors: list[str] = []
    page_parsers: dict[str, PageParser] = {}
    discovered_internal_paths: set[str] = set()
    titles: list[str] = []
    descriptions: list[str] = []

    for path in page_paths:
        body, page = parse_page(base_url, path, args.timeout, errors)
        if page is None:
            continue
        page_parsers[path] = page
        for href in page.hrefs:
            destination = internal_path(href, base_url)
            if destination:
                discovered_internal_paths.add(destination)

        if path not in article_paths:
            continue

        slug = path.rsplit("/", 1)[-1]
        canonical = f"{CANONICAL_ORIGIN}{path}"
        if page.title_count != 1 or not page.title:
            errors.append(f"TITLE {path}: attendu 1, trouvé {page.title_count}")
        meta_descriptions = page.meta.get("description", [])
        if len(meta_descriptions) != 1 or not meta_descriptions[0].strip():
            errors.append(f"META DESCRIPTION {path}: attendu 1")
        else:
            descriptions.append(meta_descriptions[0].strip())
        titles.append(page.title)
        if len(page.canonicals) != 1 or page.canonicals[0].rstrip("/") != canonical:
            errors.append(f"CANONICAL {path}: {page.canonicals}")
        if sorted(page.hreflangs) != sorted(
            [("en", canonical), ("x-default", canonical)]
        ):
            errors.append(f"HREFLANG {path}: {page.hreflangs}")

        for required_og in ("og:title", "og:description", "og:url"):
            if len(page.open_graph.get(required_og, [])) != 1:
                errors.append(f"OPEN GRAPH {path}: {required_og} absent ou dupliqué")
        og_urls = page.open_graph.get("og:url", [])
        if og_urls and og_urls[0].rstrip("/") != canonical:
            errors.append(f"OG URL {path}: {og_urls[0]}")
        if any("noindex" in value.lower() for value in page.meta.get("robots", [])):
            errors.append(f"NOINDEX {path}")
        try:
            types = schema_types(page)
        except (json.JSONDecodeError, TypeError) as error:
            errors.append(f"JSON-LD invalide {path}: {error}")
            types = []
        if not any(value in ("Article", "BlogPosting") for value in types):
            errors.append(f"JSON-LD Article absent {path}")
        if "BreadcrumbList" not in types:
            errors.append(f"JSON-LD BreadcrumbList absent {path}")

        cluster = next(name for name, slugs in CLUSTERS.items() if slug in slugs)
        peers = {
            f"{RESOURCE_HUB}/{peer}"
            for peer in CLUSTERS[cluster]
            if peer != slug
        }
        page_paths_found = {internal_path(href, base_url) for href in page.hrefs}
        if page_paths_found.isdisjoint(peers):
            errors.append(f"LIEN VERS UN ARTICLE DU CLUSTER absent {path}")
        parent = {
            "SEO Audit": "/seo-audit",
            "Local SEO": "/local-seo",
            "SEO Monitoring": "/website-monitoring",
            "SEO Reporting": "/seo-reporting",
            "SEO Competitor Analysis": "/competitor-analysis",
        }[cluster]
        if parent not in page_paths_found:
            errors.append(f"LIEN VERS LANDING absent {path} -> {parent}")

    if len(set(titles)) != len(article_paths):
        errors.append(f"TITRES NON UNIQUES: {len(set(titles))}/{len(article_paths)}")
    if len(set(descriptions)) != len(article_paths):
        errors.append(
            f"META DESCRIPTIONS NON UNIQUES: {len(set(descriptions))}/{len(article_paths)}"
        )

    hub = page_parsers.get(RESOURCE_HUB)
    if hub:
        hub_paths = {internal_path(href, base_url) for href in hub.hrefs}
        for path in article_paths:
            if path not in hub_paths:
                errors.append(f"ARTICLE ABSENT DU HUB {path}")
        hub_status, hub_html = fetch(base_url, RESOURCE_HUB, args.timeout)
        for cluster in CLUSTERS:
            if cluster not in hub_html:
                errors.append(f"THÉMATIQUE ABSENTE DU HUB {cluster}")

    for landing, slugs in LANDING_ARTICLE_LINKS.items():
        page = page_parsers.get(landing)
        if not page:
            continue
        paths = {internal_path(href, base_url) for href in page.hrefs}
        for slug in slugs:
            target = f"{RESOURCE_HUB}/{slug}"
            if target not in paths:
                errors.append(f"LIEN CONTEXTUEL ABSENT {landing} -> {target}")

    sitemap_status, sitemap_body = fetch(base_url, "/sitemap.xml", args.timeout)
    sitemap_urls: set[str] = set()
    if sitemap_status != 200:
        errors.append(f"SITEMAP HTTP {sitemap_status}")
    else:
        try:
            xml = ElementTree.fromstring(sitemap_body)
            sitemap_urls = {
                element.text or ""
                for element in xml.iter()
                if element.tag.rsplit("}", 1)[-1] == "loc"
            }
            for path in article_paths:
                expected = f"{CANONICAL_ORIGIN}{path}"
                if expected not in sitemap_urls:
                    errors.append(f"ARTICLE ABSENT DU SITEMAP {path}")
            if any(
                any(test_slug in url for test_slug in TEST_SLUGS)
                for url in sitemap_urls
            ):
                errors.append("ROUTE DE TEST OU BROUILLON DANS LE SITEMAP")
        except ElementTree.ParseError as error:
            errors.append(f"SITEMAP XML INVALIDE: {error}")

    for route in sorted(discovered_internal_paths):
        status, body = fetch(base_url, route, args.timeout)
        if status not in (200, 301, 302, 307, 308):
            errors.append(f"LIEN INTERNE HTTP {status or 'ERREUR'} {route}: {body[:120]}")

    for slug in TEST_SLUGS:
        status, _ = fetch(base_url, f"{RESOURCE_HUB}/{slug}", args.timeout)
        if status not in (404, 410):
            errors.append(f"ROUTE DE TEST ACCESSIBLE {slug}: HTTP {status}")

    print(f"Base testée : {base_url}")
    print(f"Articles attendus : {len(article_paths)} (5 clusters)")
    print(f"Pages principales HTTP 200 : {len(page_parsers)}/{len(page_paths)}")
    print(f"URL du sitemap : {len(sitemap_urls)}")
    print(f"Routes internes vérifiées : {len(discovered_internal_paths)}")
    if errors:
        print(f"ÉCHEC : {len(errors)} problème(s)")
        for error in errors:
            print(f"- {error}")
        return 1
    print("PASS : SSR, métadonnées, données structurées, hub, sitemap et liens.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
