# Real integration requirements for SEO and monitoring add-ons

This document distinguishes application code and fixtures from proof that a real provider connection works. No provider response, credential, or customer property should be fabricated for certification.

## Content Decay Radar

- **Provider:** Google Search Console (GSC), not GA4 for the current decay calculation.
- **Connection:** The organization must complete Google OAuth with the read-only Search Console scope and select/verify a property it owns.
- **Data required:** Search Analytics rows grouped by page and date, with clicks, impressions, and average position. The current analysis compares two adjacent 28-day windows and applies minimum impression thresholds; short or empty history correctly yields no opportunities.
- **Proof needed:** On Test, connect an authorized GSC property, sync real page-level rows, then verify the analysis uses those rows and reports an explicit empty state when they are insufficient. Do not infer page-query cannibalization from page-only data.
- **Separate dependency:** Any AI-written recommendation additionally needs the organization’s configured AI provider and available AI quota.

## Keyword Domination Engine

- **Provider:** DataForSEO API v3.
- **Credentials:** Either organization-scoped `dataforseo_login` and `dataforseo_password` values in the app’s secret store, or the server environment variables `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`. Organization credentials take precedence. Never place these values in source, tests, logs, or client code.
- **Provider usage:** Rank, SERP, maps, and backlink operations make paid provider requests and are accounted through the DataForSEO quota service. Availability of a credential does not prove balance, endpoint permissions, location/language coverage, or successful real task completion.
- **Proof needed:** Use an authorized Test account and an organization-approved domain/keyword set; confirm one live task succeeds, mapped results are persisted under that organization, provider errors remain explicit, and usage accounting reflects completed billable requests. Do not claim real-data certification from fixtures.

## SLA Monitoring

- **Provider:** Better Stack API using the server-side `BETTERSTACK_API_TOKEN`; it must never be sent to the browser.
- **Application ownership:** A Better Stack monitor must be registered in the app’s organization-scoped monitor ownership registry before customer reads or writes are allowed. The API token alone does not establish tenant ownership.
- **Data required:** A monitor belonging to the requesting organization and a supported time range for Better Stack SLA/response-time history.
- **Proof needed:** On Test, verify provider configuration without exposing the token, read an owned monitor’s SLA history, and confirm a monitor owned by another organization is rejected. Do not create or delete billable monitors without authorization.

## Global Monitoring

- **Provider:** The same server-side Better Stack token and organization-scoped monitor ownership registry.
- **Configuration:** Better Stack monitors must have regions explicitly configured.
- **Current measurement scope:** The feature groups real monitor-level status/uptime by the regions configured on each monitor. It does **not** perform independent checks from each region and does not currently establish per-region latency, CDN/cache detection, or geo-localized alert delivery.
- **Proof needed:** On Test, inspect an authorized organization’s actual configured monitors and compare the displayed aggregate with Better Stack. Report provider status and the actual configured regions; do not describe aggregates as independent regional measurements.
