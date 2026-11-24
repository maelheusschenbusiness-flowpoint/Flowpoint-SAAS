# FlowPoint marketing on the existing Render service

This note applies to the existing service at
`flowpoint-marketing-staging.onrender.com` and the existing PostgreSQL instance.
It does not authorize a deploy, DNS change, database write, email, audit, or
change to Replit production.

## Deployment source and build

- Repository: `maelheusschenbusiness-flowpoint/Flowpoint-SAAS`.
- Branch: `marketing-render-staging`.
- Root directory: `marketing`.
- Runtime: Node.js 20.20.0 and pnpm 10.26.1.
- Build: `corepack pnpm install --frozen-lockfile && corepack pnpm run build`.
- Start: `corepack pnpm start`.
- Health check: `/healthz` (process liveness only).
- Keep manual deploys; do not apply the repository-level `render.yaml` as a
  Blueprint. It describes other services and is not a safe update path for this
  existing service.
- Do not create a web service, PostgreSQL instance, paid add-on, or plan upgrade.

## Host-specific behavior

The built application serves both the existing Render hostname and the future
apex custom domain:

- `flowpoint-marketing-staging.onrender.com` always returns
  `X-Robots-Tag: noindex, nofollow` and does not load marketing trackers.
- `flowpoint.pro` is indexable and may load analytics only after consent.
- Render may automatically register `www.flowpoint.pro` as an alias and
  redirect it to the apex. If an alternate host reaches the app directly, it
  remains noindex and does not load marketing trackers.

Do not set a global `ROBOTS_NOINDEX=true` to distinguish these hosts. The
server now makes that decision from the incoming hostname. The Vite build flag
`VITE_ANALYTICS_DISABLED` is a global emergency switch; leave it unset or set it
to `false` for the production build only after reviewing the consent behavior.
Host checks still keep trackers disabled on the Render staging hostname.

## Existing PostgreSQL and app settings

Do not replace, migrate, or globally push the schema. First confirm which
existing Render database the service uses and inspect its schema, roles,
connection limits, and backups in read-only mode.

The service expects:

- `DATABASE_URL`: the existing Render database used for marketing leads and
  support conversations.
- `PUBLIC_AUDIT_DATABASE_URL`: the existing PostgreSQL database for audit quota
  counters and concurrency slots. It may target the same existing database as
  `DATABASE_URL` if the reviewed quota tables are present there; never create a
  database just to supply this setting.
- `SESSION_SECRET`: a production-only secret of at least 32 characters.

If the reviewed quota tables are not already available in the existing
PostgreSQL database, leave `PUBLIC_AUDIT_ENABLED=false` and stop before any SQL,
database creation, or migration. A schema write requires explicit approval.

Production audit settings to prepare in the existing Render service:

```text
PUBLIC_AUDIT_ENABLED=false
PUBLIC_AUDIT_TEST_MODE=false
PUBLIC_AUDIT_DAILY_LIMIT=10
PUBLIC_AUDIT_NETWORK_DAILY_LIMIT=5
PUBLIC_AUDIT_MAX_CONCURRENT=2
```

The per-visitor limit is fixed at three per UTC day in code. Keep the audit
disabled until its database, proxy-derived client IP, quota behavior, and
external-fetch safety have been validated and the user separately authorizes
activation.

## Forms and email

- Lead and contact forms require a same-origin request in production.
- `DATABASE_URL` must point to the existing Render database with the expected
  `leads`, `conversations`, and `messages` tables and runtime permissions.
- Configure these values only in the existing Render service's private
  Environment settings, after approval:
  - `RESEND_API_KEY`: a Resend API key for this service; do not copy a Replit
    connector credential.
  - `RESEND_FROM_EMAIL`: an existing sender verified with Resend.
  - `CONTACT_TO_EMAIL`: the inbox receiving contact form submissions; defaults
    to `support@flowpoint.pro`.
- If `RESEND_API_KEY` is absent, contact delivery fails explicitly rather than
  silently claiming success. Do not submit a real form or send a test message
  during preparation.

## Commercial tracking

- Google Analytics property: `G-32HPNSRLEM`.
- Apollo website tracker app ID: `6a6f40562eb92000180dc1c4`.
- Both third-party trackers are loaded only on `flowpoint.pro`, and only after
  analytics consent. The `onrender.com` staging hostname never loads them.
- Funnel events are consent-gated and sent to the existing endpoint on
  `app.flowpoint.pro`; accepted attribution is limited to the existing
  allowlisted fields. This work does not change or deploy `app.flowpoint.pro`.
- Keep the staging build flag `VITE_ANALYTICS_DISABLED=true` for staging-only
  builds. For the shared production service, the hostname guard—not that
  global flag—keeps staging traffic out of production trackers.
- Do not use real campaign identifiers or submit a signup during validation.

For the definitive steps, exact observed DNS baseline, Render/Namecheap
instructions, and rollback gates, see
[`flowpoint-render-cutover.md`](./flowpoint-render-cutover.md). For a possible
historical-data copy that is intentionally not executed, see
[`flowpoint-replit-data-migration.md`](./flowpoint-replit-data-migration.md).
