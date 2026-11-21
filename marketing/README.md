# FlowPoint public marketing service

This folder is an isolated marketing application added alongside the existing
FlowPoint SaaS monorepo. It does not replace or modify the SaaS package,
workspace lockfile, API, authentication, billing, or database configuration.

## Render staging setup

- Set the Render service **Root Directory** to `marketing`.
- Install with `corepack pnpm install --frozen-lockfile`.
- Build with `VITE_ANALYTICS_DISABLED=true corepack pnpm run build`.
- Start with `corepack pnpm start`.
- Use `/healthz` as the health-check path and set `ROBOTS_NOINDEX=true`.
- Keep the public audit disabled until its separate staging quota database and
  reviewed schema are ready.

Use staging-only values for `DATABASE_URL`, `PUBLIC_AUDIT_DATABASE_URL`,
`SESSION_SECRET`, `OPENAI_API_KEY`, and `RESEND_API_KEY`. Never copy production
data or production credentials into this service. The marketing application
does not need Stripe or SaaS authentication.

No Render service is created by this branch. Do not run database migrations
against the existing production database.
