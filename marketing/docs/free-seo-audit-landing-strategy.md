# Free SEO audit landing-page decision

## Existing English public-site footprint reviewed

The marketing app has dedicated English routes for the product overview, SEO
audit software, local SEO, website monitoring, reporting, competitor analysis,
pricing, benefits, resources, and company pages. The resource center currently
publishes 38 production articles. Relevant existing articles cover the general
SEO audit process, technical SEO checklists, interpreting audit results, SEO
content audits, audit priorities for small businesses, audit frequency, and
website performance monitoring.

Legacy French route aliases and existing resource URLs remain unchanged.
Production canonicals continue to use `https://flowpoint.pro`.

## Landing-page decision

Create only `/free-seo-audit`. It targets a distinct action: run a free,
no-account, one-page check. The existing `/seo-audit` page remains focused on
FlowPoint's ongoing SEO-audit software and paid trial. The new page links back
to that product page and to the technical checklist and report-interpretation
resources.

| Proposed route | Decision | Reason |
| --- | --- | --- |
| `/free-seo-audit` | Create | Distinct one-page, no-signup tool intent. |
| `/website-seo-checker` | Do not create | Same user task and tool as the free audit; would split the same intent across landing pages. |
| `/technical-seo-audit` | Do not create | Overlaps the SEO-audit product page and the existing technical SEO checklist; the free check is not a full technical audit. |
| `/website-performance-checker` | Do not create | The free check does not measure Core Web Vitals or browser performance; ongoing performance belongs with the monitoring product. |
| `/website-security-checker` | Do not create | Basic response-header signals are not a vulnerability scanner or security review. |
| `/seo-audit-report` | Do not create | Overlaps the existing report-interpretation resource and the free audit's result page. |

This is an intent and capability review of the repository, not a search-volume
study. No traffic or keyword-demand claims are made.

## Capability limits reflected in the page

The public audit checks the submitted page and a limited same-site sample. The
page describes page metadata and indexing signals, H1 count, structured-data
syntax, basic response/security signals, and sampled links/assets. It explicitly
states that the audit does not provide Core Web Vitals, rankings or traffic,
full-site crawling, browser-based visual review, or vulnerability testing.

The staging service's `ROBOTS_NOINDEX=true` setting is not changed by this
branch. Its live Render value is outside this source-only review and is not
verified here. The existing server behavior continues to add an
`X-Robots-Tag: noindex, nofollow` header when that setting is enabled.
