# FlowPoint add-on E2E scenarios

These are the narrow certification scenarios for add-on lifecycle and quota behavior. They are a test plan, not evidence that the browser flow has already passed.

## Mandatory safety preflight

- Use a dedicated PostgreSQL database that is separate from every production database.
- Confirm its host and `current_database()` value out of band, then provision the `flowpoint_test_database_guard` marker required by `addon-cert-db-guard.mjs`.
- Set the add-on certificate URL, expected host, expected database name, and `DATABASE_URL` to the same disposable target.
- Only after the marker passes may a test API process be started. Do not run migrations or the destructive certificate against an unverified database.
- Use Stripe/webhook fixtures and mocked AI, email, DataForSEO, and Google clients. Never call Stripe live or paid external APIs.
- Use a fresh organization and user identity for each run; delete only rows belonging to that run.

## Scenarios

| Case | Setup and action | Expected evidence |
|---|---|---|
| Activation and webhook | Submit a Stripe test fixture for a successful add-on subscription event; replay the same event. | One active `org_addons` entitlement; duplicate delivery does not duplicate grants or quantity. No real Stripe request. |
| Entitlement and dashboard | Load `/api/me` and `/api/billing/usage-details`, open the authenticated dashboard, then refresh. | The add-on and its exact limits are visible from API-backed state, without a placeholder or stale cached value. |
| Audit quota | Fill the test org to the standard audit limit; request one more audit, then simulate the audits pack and retry with PSI mocked. | Before activation the server rejects the request with `QUOTA_EXCEEDED`; after activation the expanded limit is applied. No real PSI call. |
| Report quota | Fill the report usage to its limit; call report creation, then simulate the PDF pack and retry with file generation mocked. | Before activation the server rejects creation; after activation it uses the expanded limit. No real PDF or AI provider call. |
| Export quota | Fill monthly export usage to its limit; call the data-export route, then simulate the export pack and retry with the file provider mocked. | Before activation the server rejects export; after activation the expanded limit is enforced. No file is sent to an external service. |
| Deactivation and access removal | Deliver a simulated subscription cancellation/update for the add-on. Reload the dashboard and repeat the over-limit API request. | The entitlement is inactive, the add-on capacity is removed, and the API rejects requests exceeding the remaining plan limit. |
| Persistence after reconnect | Sign out, create a new authenticated session for the same test user, and reload the dashboard and usage APIs. | The server-backed entitlement state remains consistent after reconnect; no browser-only state grants access. |

## Current implementation boundaries

- The existing certificate directly writes test entitlements to exercise database/API limit display and removal; it does not by itself certify a real browser lifecycle or webhook delivery.
- `POST /api/audits`, report creation, and data export now contain quota checks. This plan requires route-level assertions with provider side effects mocked before treating those paths as fully E2E-certified.
- A run is complete only when every scenario above has recorded request/response evidence and the disposable test organization's rows have been cleaned up.
